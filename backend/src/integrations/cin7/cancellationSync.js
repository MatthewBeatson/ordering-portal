// Moves portal orders to 'cancelled' when Cin7 reports their Sale as VOIDED.
//
// Why polling and not a webhook: no webhooks are registered on the Cin7
// account (GET /webhooks returns []), and Cin7 is the source of truth for a
// void -- staff void the Sale there, not here. This asks Cin7 once per run for
// "VOIDED sales updated since X" (Status + UpdatedSince filters, confirmed
// against the live account) instead of one lookup per order: the account has
// ~17,000 sales, so scanning or per-order calls would be wasteful and risk
// Cin7's rate limit.
//
// Only orders that have actually synced (an inventory_sync row with a Cin7
// SaleID) and are still live (in_progress / shipped) are candidates. Run
// triggers: throttled on order-list loads, on a timer while the server is
// awake, and on demand from staff (Orders -> Check Cin7 now). The hosting plan
// can sleep, so no single trigger is relied on.

const { supabaseAdmin } = require('../../config/supabase');
const { isConfigured, cin7Fetch } = require('./client');

const LIVE_STATUSES = ['in_progress', 'shipped'];
const PAGE_LIMIT = 100;
const MAX_PAGES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

let running = null;
let lastRunAt = 0;

async function fetchVoidedSaleIdsSince(sinceIso) {
  const ids = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({ Status: 'VOIDED', UpdatedSince: sinceIso, Limit: String(PAGE_LIMIT), Page: String(page) });
    const res = await cin7Fetch('GET', `/saleList?${qs}`);
    if (!res.ok || !Array.isArray(res.body?.SaleList)) {
      throw new Error(`Cin7 saleList failed (${res.status})`);
    }
    for (const sale of res.body.SaleList) if (sale.SaleID) ids.add(String(sale.SaleID).toLowerCase());
    if (res.body.SaleList.length < PAGE_LIMIT) break;
  }
  return ids;
}

async function runSync() {
  const { data: candidates, error } = await supabaseAdmin
    .from('inventory_sync')
    .select('order_id, external_id, synced_at, orders!inner(id, status, reference, cancellation_status)')
    .eq('provider', 'cin7')
    .not('external_id', 'is', null)
    .in('orders.status', LIVE_STATUSES);
  if (error) throw new Error(`Failed to load synced orders: ${error.message}`);
  if (!candidates || candidates.length === 0) return { checked: 0, cancelled: [] };

  // A void happens after the sync, so it can only show up as "updated" after
  // the earliest sync among the candidates -- a day's margin covers clock skew.
  const earliest = Math.min(...candidates.map((c) => new Date(c.synced_at || Date.now()).getTime()));
  const since = new Date(earliest - DAY_MS).toISOString();
  const voided = await fetchVoidedSaleIdsSince(since);

  const cancelled = [];
  for (const c of candidates) {
    if (!voided.has(String(c.external_id).toLowerCase())) continue;

    const wasRequested = c.orders.cancellation_status === 'requested';
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'cancelled',
        ...(wasRequested ? { cancellation_status: 'approved', cancellation_resolved_at: new Date().toISOString(), cancellation_resolved_by: null } : {}),
      })
      .eq('id', c.order_id)
      .in('status', LIVE_STATUSES) // never overwrite an order that moved on since we read it
      .select('id');
    if (updErr) {
      console.error(`[cin7 cancellationSync] failed to cancel order ${c.order_id}:`, updErr.message);
      continue;
    }
    if (!updated || updated.length === 0) continue;

    await supabaseAdmin.from('order_events').insert({
      order_id: c.order_id,
      actor_id: null,
      event_type: 'cancelled',
      detail: { source: 'cin7_voided', cin7_sale_id: c.external_id, from_status: c.orders.status },
    });
    cancelled.push({ id: c.order_id, reference: c.orders.reference });
  }
  return { checked: candidates.length, cancelled };
}

// Single-flight: overlapping triggers share one run instead of stacking up.
function syncVoidedOrders() {
  if (!isConfigured()) return Promise.resolve({ checked: 0, cancelled: [], skipped: 'cin7_not_configured' });
  if (!running) {
    running = runSync().finally(() => {
      running = null;
      lastRunAt = Date.now();
    });
  }
  return running;
}

// Fire-and-forget, at most once per `minIntervalMs`. Never throws.
function maybeSyncVoidedOrders(minIntervalMs = 5 * 60 * 1000) {
  if (running || Date.now() - lastRunAt < minIntervalMs) return;
  syncVoidedOrders().catch((err) => console.error('[cin7 cancellationSync] run failed:', err.message));
}

function startCancellationSyncTimer(intervalMs = 15 * 60 * 1000) {
  const timer = setInterval(() => maybeSyncVoidedOrders(intervalMs - 1000), intervalMs);
  timer.unref();
  return timer;
}

module.exports = { syncVoidedOrders, maybeSyncVoidedOrders, startCancellationSyncTimer };
