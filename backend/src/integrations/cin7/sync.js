// Orchestrates syncing a confirmed order to Cin7 as a Sale. This is the
// only file (besides client.js itself) that talks to Cin7; everything
// else in the app goes through this module's exported functions.
//
// V2 was picked over V1 because V2's ExternalID field (set to
// orders.idempotency_key) gives a real, queryable dedup mechanism,
// confirmed via a live create-then-search round trip against a trial
// account -- V1 has no idempotency key at all.

const { supabaseAdmin } = require('../../config/supabase');
const cin7 = require('./client');
const { buildSaleOrderLines } = require('./lines');

// Fields we need before it's even worth calling Cin7. Failing fast here
// beats sending a request we already know is malformed.
function validateSyncable(client, store, lines) {
  const problems = [];
  if (!client?.cin7_customer_id) problems.push('client has no cin7_customer_id');
  if (!client?.cin7_tax_rule) problems.push('client has no cin7_tax_rule configured (see 005_client_tax.sql)');
  if (!store?.cin7_address_line1) problems.push('store has no pinned cin7_address_line1');
  if (!lines || lines.length === 0) problems.push('order has no order_lines');
  return problems;
}

async function logEvent(orderId, eventType, detail) {
  await supabaseAdmin.from('order_events').insert({ order_id: orderId, actor_id: null, event_type: eventType, detail });
}

// On success: order_status moves to 'in_progress' automatically (the
// "confirmed -> in_progress" trigger is simply "the sync succeeded") --
// no manual "start" step for the normal case, backorders included (see
// lines.js / raw_payload note below).
async function recordSynced(orderId, externalId, rawPayload) {
  await supabaseAdmin.from('inventory_sync').upsert(
    {
      order_id: orderId,
      provider: 'cin7',
      external_id: externalId,
      status: 'synced',
      error_message: null,
      raw_payload: rawPayload ?? null,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'order_id,provider' }
  );

  const { data, error } = await supabaseAdmin.from('orders').update({ status: 'in_progress' }).eq('id', orderId).select().single();
  if (error) console.error(`[cin7] order ${orderId} synced but failed to update order_status:`, error.message);

  await logEvent(orderId, 'synced', { provider: 'cin7', external_id: externalId });
  return data;
}

// On failure: the order itself is NOT moved off 'confirmed' -- a sync
// failure is provider infrastructure detail, recorded in inventory_sync,
// not a distinct core order_status. Never silently stuck: the failure
// is visible in inventory_sync.status/error_message and logged as an
// order_event. Nothing here retries automatically.
async function recordFailed(orderId, message) {
  await supabaseAdmin.from('inventory_sync').upsert(
    {
      order_id: orderId,
      provider: 'cin7',
      status: 'failed',
      error_message: message,
    },
    { onConflict: 'order_id,provider' }
  );

  await logEvent(orderId, 'sync_failed', { provider: 'cin7', error: message });

  const { data } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).maybeSingle();
  return data;
}

// Called after an order moves to 'confirmed'. Never throws -- confirming
// the order already succeeded and shouldn't be undone by a sync
// problem. Returns the order row reflecting the final post-attempt
// state (status stays 'confirmed' on failure/hold, becomes
// 'in_progress' on success).
async function syncOrderToCin7(order) {
  const { data: fresh, error: fetchErr } = await supabaseAdmin.from('orders').select('*').eq('id', order.id).maybeSingle();
  if (fetchErr || !fresh) {
    console.error(`[cin7] could not re-fetch order ${order.id} before sync:`, fetchErr?.message);
    return order;
  }

  // Review hold: while flagged, skip the sync attempt entirely and
  // leave the order at 'confirmed'. The flag/clear-flag actions log
  // their own order_events, so nothing extra is logged here.
  if (fresh.flagged_for_review) {
    console.log(`[cin7] order ${fresh.id} is flagged for review -- skipping sync`);
    return fresh;
  }

  if (!cin7.isConfigured()) {
    return recordFailed(fresh.id, 'CIN7_ACCOUNT_ID / CIN7_APPLICATION_KEY are not configured');
  }

  // Local idempotency guard: skip immediately if already recorded synced.
  const { data: existingSync } = await supabaseAdmin
    .from('inventory_sync')
    .select('*')
    .eq('order_id', fresh.id)
    .eq('provider', 'cin7')
    .maybeSingle();
  if (existingSync?.status === 'synced' && existingSync.external_id) {
    console.log(`[cin7] order ${fresh.id} already synced (Cin7 Sale ${existingSync.external_id}) -- skipping`);
    return fresh;
  }

  const { data: store, error: storeErr } = await supabaseAdmin
    .from('stores')
    .select('*, clients(*)')
    .eq('id', fresh.store_id)
    .maybeSingle();
  const { data: lines, error: linesErr } = await supabaseAdmin.from('order_lines').select('*').eq('order_id', fresh.id);

  if (storeErr || linesErr || !store) {
    return recordFailed(fresh.id, `Failed to load store/client/lines: ${storeErr?.message || linesErr?.message || 'store not found'}`);
  }

  const client = store.clients;
  const problems = validateSyncable(client, store, lines);
  if (problems.length > 0) {
    return recordFailed(fresh.id, `Order is not ready to sync: ${problems.join('; ')}`);
  }

  const saleLines = buildSaleOrderLines(lines, client);

  try {
    // Cin7-side idempotency check: closes the gap the local-only guard
    // above can't -- if a previous attempt created the Sale in Cin7 but
    // we never recorded it locally (e.g. a timeout), ExternalID finds
    // it instead of creating a duplicate.
    let saleId;
    let orderResBody;
    const existing = await cin7.findExistingSale(fresh.idempotency_key);

    if (existing) {
      saleId = existing.SaleID;
      const full = await cin7.fetchFullSale(saleId);
      const hasLines = full?.Order?.Lines?.length > 0;
      if (hasLines) {
        orderResBody = full.Order;
      } else {
        console.log(`[cin7] order ${fresh.id}: found existing Sale ${saleId} with no lines yet -- completing it`);
        const orderRes = await cin7.createSaleOrderLines(saleId, saleLines);
        if (!orderRes.ok) {
          return recordFailed(fresh.id, cin7.cin7ErrorMessage(orderRes));
        }
        orderResBody = orderRes.body;
      }
    } else {
      const saleRes = await cin7.createSaleHeader(fresh, store, client);
      if (!saleRes.ok) {
        return recordFailed(fresh.id, cin7.cin7ErrorMessage(saleRes));
      }
      saleId = saleRes.body?.ID;
      if (!saleId) {
        return recordFailed(fresh.id, `Cin7 returned 200 but no Sale ID in the response: ${JSON.stringify(saleRes.body)}`);
      }

      const orderRes = await cin7.createSaleOrderLines(saleId, saleLines);
      if (!orderRes.ok) {
        // The Sale header DOES now exist in Cin7 (with ExternalID set),
        // just without lines yet -- a retry will find and complete it
        // via the existing-Sale branch above, rather than creating a
        // second header.
        return recordFailed(fresh.id, `Sale header ${saleId} created but order lines failed: ${cin7.cin7ErrorMessage(orderRes)}`);
      }
      orderResBody = orderRes.body;
    }

    // Cin7 silently creates a backorder if quantity exceeds stock (no
    // error) -- that's a normal in_progress order, not a failure.
    // BackorderQuantity (present per-line in Cin7's response) is kept
    // in raw_payload for staff visibility, not surfaced as an error.
    console.log(`[cin7] order ${fresh.id} synced -> Cin7 Sale ${saleId}`);
    return recordSynced(fresh.id, saleId, orderResBody);
  } catch (err) {
    return recordFailed(fresh.id, err.message);
  }
}

module.exports = { syncOrderToCin7 };
