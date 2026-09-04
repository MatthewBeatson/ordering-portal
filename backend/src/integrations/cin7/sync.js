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
// Resolves the address actually sent to Cin7 for this Sale. The
// store's matched Cin7 address (stores.client_address_id, 027) wins
// when assigned -- it's the client's own real Cin7 data, kept in sync.
// Falls back to the store's pinned cin7_address_* fields (the only
// thing that existed before 027, and still the one validateSyncable
// requires) if nothing's assigned, or if the assigned address has
// since vanished (e.g. removed in Cin7 and pruned by addressSync.js) --
// never fails a sync over this, just falls through.
async function resolveShippingAddress(store) {
  if (store.client_address_id) {
    const { data: address, error } = await supabaseAdmin
      .from('client_addresses')
      .select('line1, line2, city, state, postcode, country')
      .eq('id', store.client_address_id)
      .maybeSingle();
    if (!error && address) {
      return {
        Line1: address.line1,
        Line2: address.line2 || undefined,
        City: address.city || undefined,
        State: address.state || undefined,
        Postcode: address.postcode || undefined,
        Country: address.country || undefined,
      };
    }
  }
  return {
    Line1: store.cin7_address_line1,
    Line2: store.cin7_address_line2 || undefined,
    City: store.cin7_address_city || undefined,
    State: store.cin7_address_state || undefined,
    Postcode: store.cin7_address_postcode || undefined,
    Country: store.cin7_address_country || undefined,
  };
}

// Resolves each order line's CLIENT SKU (client_product_skus) by
// sku -> product -> client_sku, and builds a "<current Cin7 name> -
// <client sku>" Name override from it -- confirmed with the client:
// Cin7's own per-line Comment field isn't actually shown on standard
// Sale reports/PDF templates, but Name/description always is, so
// that's the reliable place to put this. `product.name` here is
// whatever productSync.js most recently synced from Cin7 (it's kept
// current on every sync, unlike the portal-native taxonomy fields), so
// the override always reflects Cin7's current master name, never a
// stale copy. Comment is set too, at no extra cost, in case a
// particular template does surface it. Best-effort throughout: any
// lookup failure just means those lines go without an override, never
// fails the sync.
async function resolveLineOverrides(lines, clientId) {
  const skus = [...new Set(lines.map((l) => l.sku))];
  if (skus.length === 0) return new Map();

  const { data: products, error: productsErr } = await supabaseAdmin.from('products').select('id, sku, name').in('sku', skus);
  if (productsErr || !products) return new Map();

  const { data: clientSkuRows, error: skusErr } = await supabaseAdmin
    .from('client_product_skus')
    .select('product_id, client_sku')
    .eq('client_id', clientId)
    .in('product_id', products.map((p) => p.id));
  if (skusErr) console.error('[cin7] failed to resolve client SKUs for line overrides:', skusErr.message);
  const clientSkuByProductId = new Map((clientSkuRows || []).map((r) => [r.product_id, r.client_sku]));

  const result = new Map();
  for (const product of products) {
    const clientSku = clientSkuByProductId.get(product.id);
    if (clientSku) result.set(product.sku, { name: `${product.name} - ${clientSku}`, clientSku });
  }
  return result;
}

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

  const lineOverrides = await resolveLineOverrides(lines, client.id);
  const saleLines = buildSaleOrderLines(lines, client, lineOverrides);

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
      const shippingAddress = await resolveShippingAddress(store);
      const saleRes = await cin7.createSaleHeader(fresh, shippingAddress, client);
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
