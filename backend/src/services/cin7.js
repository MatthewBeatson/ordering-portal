// Cin7 Core (V1) Sale sync — Phase 4.
//
// API contract verified against official docs, not guessed:
//   - Auth:     https://help.core.cin7.com/hc/en-us/articles/9982480315407
//   - POST /Sale: https://help.core.cin7.com/hc/en-us/articles/9034512161423
//   - GET /Sale:  https://help.core.cin7.com/hc/en-us/articles/9034512071951
//     (confirms the created Sale's id comes back as `ID`)
//
// V1 was used instead of V2 because V2's nested line-item object (the
// part that actually carries SKU/quantity/price) isn't published in
// Cin7's text reference docs — only via a sign-in-gated API Explorer —
// so it couldn't be verified rather than guessed. V1's Sale Line fields
// are fully documented. V2 does have a real ExternalID idempotency
// field V1 lacks; if V2's line schema ever gets verified (e.g. against
// a trial account), that's worth revisiting.
//
// No idempotency key exists in V1, so the fallback is the one the
// schema actually supports: re-check cin7_sales_order_id is still null
// immediately before calling create. This does not close every gap
// (a request that times out after Cin7 already created the Sale, but
// before we recorded the id, could still double-create on a naive
// retry) — there's no server-side dedup lever available in V1 to close
// that completely.

const { supabaseAdmin } = require('../config/supabase');

const CIN7_API_BASE_URL = process.env.CIN7_API_BASE_URL || 'https://inventory.dearsystems.com/ExternalApi';
const CIN7_ACCOUNT_ID = process.env.CIN7_ACCOUNT_ID;
const CIN7_APPLICATION_KEY = process.env.CIN7_APPLICATION_KEY;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function buildSaleLine(line, client) {
  const quantity = Number(line.quantity);
  const price = Number(line.unit_price ?? 0);
  const subtotal = round2(quantity * price);
  const tax = round2(subtotal * Number(client.tax_rate));
  return {
    SKU: line.sku,
    Quantity: quantity,
    Price: price,
    Tax: tax,
    Total: round2(subtotal + tax),
    TaxRule: client.cin7_tax_rule,
    Comment: line.description || undefined,
  };
}

function buildSalePayload(order, store, client, lines) {
  return {
    CustomerID: client.cin7_customer_id,
    CustomerReference: order.cin7_reference || undefined,
    ShippingAddress: {
      Line1: store.cin7_address_line1,
      Line2: store.cin7_address_line2 || undefined,
      City: store.cin7_address_city || undefined,
      State: store.cin7_address_state || undefined,
      Postcode: store.cin7_address_postcode || undefined,
      Country: store.cin7_address_country || undefined,
    },
    TaxRule: client.cin7_tax_rule,
    TaxInclusive: false,
    OrderStatus: 'AUTHORISED',
    // Explicitly not authorising the invoice at sync time -- billing
    // happens as a separate later step, not automatically on approval.
    AutoPickPackShipMode: 'NOPICK',
    Lines: lines.map((l) => buildSaleLine(l, client)),
  };
}

// Fields we need before it's even worth calling Cin7. Failing fast here
// with a specific message beats sending a request we already know is
// malformed and parsing a generic Cin7 validation error for it.
function validateSyncable(order, store, client, lines) {
  const problems = [];
  if (!client?.cin7_customer_id) problems.push('client has no cin7_customer_id');
  if (!client?.cin7_tax_rule) problems.push('client has no cin7_tax_rule configured (see 005_client_tax.sql)');
  if (!store?.cin7_address_line1) problems.push('store has no pinned cin7_address_line1');
  if (!lines || lines.length === 0) problems.push('order has no order_lines');
  return problems;
}

async function logSyncEvent(orderId, eventType, detail) {
  await supabaseAdmin.from('order_events').insert({
    order_id: orderId,
    actor_id: null, // system/automated event
    event_type: eventType,
    detail,
  });
}

async function markSynced(orderId, cin7SaleId) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({ status: 'synced_to_cin7', cin7_sales_order_id: cin7SaleId, cin7_sync_error: null })
    .eq('id', orderId)
    .select()
    .single();
  if (error) console.error(`[cin7] order ${orderId} synced but failed to update local status:`, error.message);
  await logSyncEvent(orderId, 'synced', { cin7_sales_order_id: cin7SaleId });
  return data;
}

async function markSyncFailed(orderId, message) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({ status: 'sync_failed', cin7_sync_error: message })
    .eq('id', orderId)
    .select()
    .single();
  if (error) console.error(`[cin7] order ${orderId} failed to sync AND failed to record the failure:`, error.message);
  await logSyncEvent(orderId, 'sync_failed', { error: message });
  return data;
}

// Called after an order moves to 'approved'. Never throws -- approval
// itself already succeeded and shouldn't be undone by a sync problem;
// failures are recorded on the order (status + cin7_sync_error) for a
// human to act on, per the "never leave it silently stuck" requirement.
// Returns the order row reflecting the final post-sync-attempt state.
async function syncOrderToCin7(order) {
  if (!CIN7_ACCOUNT_ID || !CIN7_APPLICATION_KEY) {
    const message = 'CIN7_ACCOUNT_ID / CIN7_APPLICATION_KEY are not configured';
    console.error(`[cin7] ${message} -- cannot sync order ${order.id}`);
    return markSyncFailed(order.id, message);
  }

  // Idempotency guard: re-fetch rather than trust the passed-in row, in
  // case this order was already synced by an earlier call.
  const { data: fresh, error: fetchErr } = await supabaseAdmin.from('orders').select('*').eq('id', order.id).maybeSingle();
  if (fetchErr || !fresh) {
    console.error(`[cin7] could not re-fetch order ${order.id} before sync:`, fetchErr?.message);
    return order;
  }
  if (fresh.cin7_sales_order_id) {
    console.log(`[cin7] order ${fresh.id} already synced (Cin7 Sale ${fresh.cin7_sales_order_id}) -- skipping`);
    return fresh;
  }

  const { data: store, error: storeErr } = await supabaseAdmin
    .from('stores')
    .select('*, clients(*)')
    .eq('id', fresh.store_id)
    .maybeSingle();
  const { data: lines, error: linesErr } = await supabaseAdmin.from('order_lines').select('*').eq('order_id', fresh.id);

  if (storeErr || linesErr || !store) {
    const message = `Failed to load store/client/lines: ${storeErr?.message || linesErr?.message || 'store not found'}`;
    console.error(`[cin7] ${message}`);
    return markSyncFailed(fresh.id, message);
  }

  const client = store.clients;
  const problems = validateSyncable(fresh, store, client, lines);
  if (problems.length > 0) {
    const message = `Order is not ready to sync: ${problems.join('; ')}`;
    console.error(`[cin7] order ${fresh.id}: ${message}`);
    return markSyncFailed(fresh.id, message);
  }

  const payload = buildSalePayload(fresh, store, client, lines);

  try {
    const response = await fetch(`${CIN7_API_BASE_URL}/Sale`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-auth-accountid': CIN7_ACCOUNT_ID,
        'api-auth-applicationkey': CIN7_APPLICATION_KEY,
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message = Array.isArray(body)
        ? body.map((e) => e.Exception || JSON.stringify(e)).join('; ')
        : `HTTP ${response.status}: ${JSON.stringify(body)}`;
      console.error(`[cin7] order ${fresh.id} sync failed:`, message);
      return markSyncFailed(fresh.id, message);
    }

    const cin7SaleId = body?.ID;
    if (!cin7SaleId) {
      const message = `Cin7 returned 200 but no Sale ID in the response body: ${JSON.stringify(body)}`;
      console.error(`[cin7] ${message}`);
      return markSyncFailed(fresh.id, message);
    }

    console.log(`[cin7] order ${fresh.id} synced -> Cin7 Sale ${cin7SaleId}`);
    return markSynced(fresh.id, cin7SaleId);
  } catch (err) {
    console.error(`[cin7] order ${fresh.id} sync threw:`, err.message);
    return markSyncFailed(fresh.id, err.message);
  }
}

module.exports = { syncOrderToCin7 };
