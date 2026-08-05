// Cin7 Core (V2) Sale sync — Phase 4.
//
// V2 was originally passed over because its nested line-item schema
// wasn't in the published text docs (only a sign-in-gated API
// Explorer). Once a trial account was available, the actual schema was
// verified empirically against a real Cin7 Core trial ("Cleo's Loft")
// rather than guessed:
//   - POST /Sale creates the customer-linked Sale header.
//   - POST /Sale/Order (SaleID + Lines, confirmed via Cin7's own
//     validation errors: Quantity/Price/Total/TaxRule required per
//     line) sets the order lines and authorizes the order in one call.
//   - GET /SaleList?ExternalID=<value> finds a Sale by a caller-supplied
//     ExternalID, confirmed via a real create-then-search round trip.
//   - The created Sale's unique id comes back as `ID` (confirmed via a
//     live POST /Sale response).
// This is why V2 was picked over V1 in the end: V1 has no idempotency
// key at all, whereas V2's ExternalID (set to orders.idempotency_key)
// gives a real, queryable dedup mechanism -- verified working, not
// assumed.
//
// Auth headers (api-auth-accountid / api-auth-applicationkey) are the
// same for both API versions:
//   https://help.core.cin7.com/hc/en-us/articles/9982480315407

const { supabaseAdmin } = require('../config/supabase');

const CIN7_API_BASE_URL = process.env.CIN7_API_BASE_URL || 'https://inventory.dearsystems.com/ExternalApi/v2';
const CIN7_ACCOUNT_ID = process.env.CIN7_ACCOUNT_ID;
const CIN7_APPLICATION_KEY = process.env.CIN7_APPLICATION_KEY;

async function cin7Fetch(method, path, body) {
  const response = await fetch(`${CIN7_API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'api-auth-accountid': CIN7_ACCOUNT_ID,
      'api-auth-applicationkey': CIN7_APPLICATION_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsedBody = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body: parsedBody };
}

function cin7ErrorMessage(res) {
  if (Array.isArray(res.body)) return res.body.map((e) => e.Exception || JSON.stringify(e)).join('; ');
  return `HTTP ${res.status}: ${JSON.stringify(res.body)}`;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function buildSaleOrderLine(line, client) {
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

// Fields we need before it's even worth calling Cin7.
function validateSyncable(client, store, lines) {
  const problems = [];
  if (!client?.cin7_customer_id) problems.push('client has no cin7_customer_id');
  if (!client?.cin7_tax_rule) problems.push('client has no cin7_tax_rule configured (see 005_client_tax.sql)');
  if (!store?.cin7_address_line1) problems.push('store has no pinned cin7_address_line1');
  if (!lines || lines.length === 0) problems.push('order has no order_lines');
  return problems;
}

async function logSyncEvent(orderId, eventType, detail) {
  await supabaseAdmin.from('order_events').insert({ order_id: orderId, actor_id: null, event_type: eventType, detail });
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

// Looks up a Sale by ExternalID (our orders.idempotency_key). Returns
// the matching SaleList row, or null if none exists yet.
async function findExistingSale(externalId) {
  const res = await cin7Fetch('GET', `/SaleList?ExternalID=${encodeURIComponent(externalId)}`);
  if (!res.ok) return null;
  return res.body?.SaleList?.[0] || null;
}

async function fetchFullSale(saleId) {
  const res = await cin7Fetch('GET', `/Sale?ID=${encodeURIComponent(saleId)}`);
  return res.ok ? res.body : null;
}

async function createSaleHeader(order, store, client) {
  return cin7Fetch('POST', '/Sale', {
    CustomerID: client.cin7_customer_id,
    SkipQuote: true,
    ExternalID: order.idempotency_key,
    CustomerReference: order.cin7_reference || undefined,
    TaxRule: client.cin7_tax_rule,
    ShippingAddress: {
      Line1: store.cin7_address_line1,
      Line2: store.cin7_address_line2 || undefined,
      City: store.cin7_address_city || undefined,
      State: store.cin7_address_state || undefined,
      Postcode: store.cin7_address_postcode || undefined,
      Country: store.cin7_address_country || undefined,
    },
  });
}

async function createSaleOrderLines(saleId, client, lines) {
  return cin7Fetch('POST', '/Sale/Order', {
    SaleID: saleId,
    Status: 'AUTHORISED',
    Lines: lines.map((l) => buildSaleOrderLine(l, client)),
  });
}

// Called after an order moves to 'approved'. Never throws -- approval
// itself already succeeded and shouldn't be undone by a sync problem;
// failures are recorded on the order (status + cin7_sync_error) for a
// human to act on. Returns the order row reflecting the final
// post-sync-attempt state.
async function syncOrderToCin7(order) {
  if (!CIN7_ACCOUNT_ID || !CIN7_APPLICATION_KEY) {
    const message = 'CIN7_ACCOUNT_ID / CIN7_APPLICATION_KEY are not configured';
    console.error(`[cin7] ${message} -- cannot sync order ${order.id}`);
    return markSyncFailed(order.id, message);
  }

  // Local guard: skip immediately if we already recorded a Cin7 id.
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
  const problems = validateSyncable(client, store, lines);
  if (problems.length > 0) {
    const message = `Order is not ready to sync: ${problems.join('; ')}`;
    console.error(`[cin7] order ${fresh.id}: ${message}`);
    return markSyncFailed(fresh.id, message);
  }

  try {
    // Cin7-side idempotency check: closes the gap the local-only guard
    // above can't -- if a previous attempt created the Sale in Cin7 but
    // we never recorded it locally (e.g. timeout), ExternalID finds it
    // instead of creating a duplicate.
    let saleId;
    const existing = await findExistingSale(fresh.idempotency_key);

    if (existing) {
      saleId = existing.SaleID;
      const full = await fetchFullSale(saleId);
      const hasLines = full?.Order?.Lines?.length > 0;
      if (!hasLines) {
        console.log(`[cin7] order ${fresh.id}: found existing Sale ${saleId} with no lines yet -- completing it`);
        const orderRes = await createSaleOrderLines(saleId, client, lines);
        if (!orderRes.ok) {
          const message = cin7ErrorMessage(orderRes);
          console.error(`[cin7] order ${fresh.id} failed to complete existing Sale ${saleId}:`, message);
          return markSyncFailed(fresh.id, message);
        }
      }
    } else {
      const saleRes = await createSaleHeader(fresh, store, client);
      if (!saleRes.ok) {
        const message = cin7ErrorMessage(saleRes);
        console.error(`[cin7] order ${fresh.id} sale creation failed:`, message);
        return markSyncFailed(fresh.id, message);
      }
      saleId = saleRes.body?.ID;
      if (!saleId) {
        const message = `Cin7 returned 200 but no Sale ID in the response: ${JSON.stringify(saleRes.body)}`;
        return markSyncFailed(fresh.id, message);
      }

      const orderRes = await createSaleOrderLines(saleId, client, lines);
      if (!orderRes.ok) {
        // The Sale header DOES now exist in Cin7 (with ExternalID set),
        // just without lines yet -- a retry will find and complete it
        // via the existing-Sale branch above, rather than creating a
        // second header.
        const message = `Sale header ${saleId} created but order lines failed: ${cin7ErrorMessage(orderRes)}`;
        console.error(`[cin7] order ${fresh.id}: ${message}`);
        return markSyncFailed(fresh.id, message);
      }
    }

    console.log(`[cin7] order ${fresh.id} synced -> Cin7 Sale ${saleId}`);
    return markSynced(fresh.id, saleId);
  } catch (err) {
    console.error(`[cin7] order ${fresh.id} sync threw:`, err.message);
    return markSyncFailed(fresh.id, err.message);
  }
}

module.exports = { syncOrderToCin7 };
