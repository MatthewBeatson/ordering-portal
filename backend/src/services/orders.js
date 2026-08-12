const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');
const { syncOrderToCin7 } = require('../integrations/cin7/sync');

// pending -> confirmed -> in_progress -> shipped -> delivered, with
// 'rejected' as a pre-confirm terminal state. 'in_progress' is entered
// automatically the moment a confirmed order successfully syncs to
// Cin7 (see integrations/cin7/sync.js) -- there's no manual "start"
// step for the normal case, backorders included.
const PRE_CONFIRM_STATUSES = ['pending'];
const FLAGGABLE_STATUSES = ['pending', 'confirmed'];
const PRE_SYNC_STATUSES = ['pending', 'confirmed']; // not yet reached in_progress

// flagged_for_review/flagged_reason/flagged_by/reviewed_* are an
// internal Shonrei-staff-only hold -- client-facing views must never
// see them; they just see 'confirmed'.
function sanitizeOrder(order, isPortalAdmin) {
  if (!order || isPortalAdmin) return order;
  // eslint-disable-next-line no-unused-vars
  const { flagged_for_review, flagged_reason, flagged_by, reviewed_by, reviewed_at, ...rest } = order;
  return rest;
}

function requireStaff(req) {
  if (!req.roles.isPortalAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei staff');
  }
}

async function checkStoreAccess(supabaseUser, storeId) {
  const { data, error } = await supabaseUser.rpc('has_store_access', { target_store_id: storeId });
  if (error) throw new ApiError(500, 'Failed to check store access', error.message);
  return data === true;
}

async function checkCanApprove(supabaseUser, storeId) {
  const { data, error } = await supabaseUser.rpc('can_approve', { target_store_id: storeId });
  if (error) throw new ApiError(500, 'Failed to check approval rights', error.message);
  return data === true;
}

function isInvalidUuidError(error) {
  // Postgres 22P02 = invalid_text_representation (e.g. bad uuid literal)
  return error?.code === '22P02' || error?.code === 'PGRST102';
}

function validateCreateInput(body) {
  const errors = [];
  if (!body || typeof body !== 'object') errors.push('Request body must be a JSON object');

  const storeId = body?.store_id;
  if (!storeId || typeof storeId !== 'string') errors.push('store_id is required');

  const lines = body?.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    errors.push('lines must be a non-empty array');
  } else {
    lines.forEach((line, i) => {
      if (!line || typeof line.sku !== 'string' || !line.sku.trim()) {
        errors.push(`lines[${i}].sku is required`);
      }
      if (typeof line.quantity !== 'number' || line.quantity <= 0) {
        errors.push(`lines[${i}].quantity must be a number > 0`);
      }
      if (line.unit_price != null && typeof line.unit_price !== 'number') {
        errors.push(`lines[${i}].unit_price must be a number`);
      }
    });
  }

  if (errors.length > 0) throw new ApiError(400, 'Invalid order payload', errors);

  return { storeId, notes: body.notes ?? null, lines };
}

async function fetchOrder(orderId) {
  const { data, error } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (error) {
    if (isInvalidUuidError(error)) throw new ApiError(400, 'Invalid order id');
    throw new ApiError(500, 'Failed to fetch order', error.message);
  }
  if (!data) throw new ApiError(404, 'Order not found');
  return data;
}

async function logEvent(orderId, actorId, eventType, detail) {
  await supabaseAdmin.from('order_events').insert({ order_id: orderId, actor_id: actorId, event_type: eventType, detail });
}

// Defense-in-depth: even though the Catalog page only ever shows a
// client's own curated products (013_per_client_portal_products.sql),
// this is the actual enforcement point -- nothing reaches order_lines
// unless every SKU is genuinely curated for the target client. Closes
// the gap a UI bug, stale cache, or a future screen could otherwise
// open (e.g. a staff member testing as one client's store must never
// be able to accidentally order another client's product onto it).
async function findSkusNotCuratedForClient(clientId, skus) {
  const uniqueSkus = [...new Set(skus)];
  const { data: products, error: prodErr } = await supabaseAdmin.from('products').select('id, sku').in('sku', uniqueSkus);
  if (prodErr) throw new ApiError(500, 'Failed to validate order lines', prodErr.message);

  const productIdBySku = new Map(products.map((p) => [p.sku, p.id]));
  const unknownSkus = uniqueSkus.filter((sku) => !productIdBySku.has(sku));

  const productIds = [...productIdBySku.values()];
  let curatedProductIds = new Set();
  if (productIds.length > 0) {
    const { data: curated, error: curatedErr } = await supabaseAdmin
      .from('client_portal_products')
      .select('product_id')
      .eq('client_id', clientId)
      .in('product_id', productIds);
    if (curatedErr) throw new ApiError(500, 'Failed to validate order lines', curatedErr.message);
    curatedProductIds = new Set(curated.map((c) => c.product_id));
  }

  const notCurated = [...productIdBySku.entries()].filter(([, id]) => !curatedProductIds.has(id)).map(([sku]) => sku);
  return [...new Set([...unknownSkus, ...notCurated])];
}

async function createOrder(req) {
  const { storeId, notes, lines } = validateCreateInput(req.body);

  // Never trust a client-supplied store_id blindly -- check it against
  // this user's actual roles before touching the database.
  const hasAccess = await checkStoreAccess(req.supabaseUser, storeId);
  if (!hasAccess) {
    throw new ApiError(403, 'You do not have access to this store');
  }

  const { data: store, error: storeErr } = await supabaseAdmin.from('stores').select('client_id').eq('id', storeId).maybeSingle();
  if (storeErr || !store) throw new ApiError(400, 'Invalid store_id');

  const invalidSkus = await findSkusNotCuratedForClient(store.client_id, lines.map((l) => l.sku));
  if (invalidSkus.length > 0) {
    throw new ApiError(400, "These SKUs aren't available on this client's portal", invalidSkus);
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .insert({ store_id: storeId, requested_by: req.user.id, status: 'pending', notes })
    .select()
    .single();

  if (orderErr) {
    if (isInvalidUuidError(orderErr)) throw new ApiError(400, 'Invalid store_id');
    throw new ApiError(500, 'Failed to create order', orderErr.message);
  }

  const { data: orderLines, error: linesErr } = await supabaseAdmin
    .from('order_lines')
    .insert(
      lines.map((l) => ({
        order_id: order.id,
        sku: l.sku,
        description: l.description ?? null,
        quantity: l.quantity,
        unit_price: l.unit_price ?? null,
      }))
    )
    .select();

  if (linesErr) {
    // Best-effort cleanup so a failed create doesn't leave an empty order behind.
    await supabaseAdmin.from('orders').delete().eq('id', order.id);
    throw new ApiError(500, 'Failed to create order lines', linesErr.message);
  }

  await logEvent(order.id, req.user.id, 'created', { status: 'pending' });

  return { ...sanitizeOrder(order, req.roles.isPortalAdmin), order_lines: orderLines };
}

async function listOrders(req) {
  const accessibleStoreIds = [...req.roles.accessibleStoreIds];

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  if (accessibleStoreIds.length === 0) {
    return { orders: [], total: 0, limit, offset };
  }

  let query = supabaseAdmin
    .from('orders')
    .select('*', { count: 'exact' })
    .in('store_id', accessibleStoreIds)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (req.query.status) {
    query = query.eq('status', req.query.status);
  }

  const { data, error, count } = await query;
  if (error) throw new ApiError(500, 'Failed to list orders', error.message);

  // Staff-only, same boundary as getOrder's inventory_sync -- one
  // batched query for the whole page rather than one per row.
  let syncByOrderId = new Map();
  if (req.roles.isPortalAdmin && data.length > 0) {
    const { data: syncs } = await supabaseAdmin
      .from('inventory_sync')
      .select('order_id, provider, status, external_id, error_message, synced_at')
      .eq('provider', 'cin7')
      .in(
        'order_id',
        data.map((o) => o.id)
      );
    syncByOrderId = new Map((syncs || []).map((s) => [s.order_id, s]));
  }

  return {
    orders: data.map((o) => {
      const sanitized = sanitizeOrder(o, req.roles.isPortalAdmin);
      if (req.roles.isPortalAdmin) sanitized.inventory_sync = syncByOrderId.get(o.id) || null;
      return sanitized;
    }),
    total: count,
    limit,
    offset,
  };
}

async function getOrder(req, orderId) {
  const order = await fetchOrder(orderId);

  const hasAccess = await checkStoreAccess(req.supabaseUser, order.store_id);
  if (!hasAccess) throw new ApiError(403, 'You do not have access to this order');

  const { data: lines, error: linesErr } = await supabaseAdmin
    .from('order_lines')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (linesErr) throw new ApiError(500, 'Failed to fetch order lines', linesErr.message);

  const result = { ...sanitizeOrder(order, req.roles.isPortalAdmin), order_lines: lines };

  // Sync status is Shonrei-internal infrastructure detail -- same
  // staff-only boundary as flagged_for_review, not client-facing.
  if (req.roles.isPortalAdmin) {
    const { data: sync } = await supabaseAdmin
      .from('inventory_sync')
      .select('provider, status, external_id, error_message, synced_at')
      .eq('order_id', orderId)
      .eq('provider', 'cin7')
      .maybeSingle();
    result.inventory_sync = sync || null;
  }

  return result;
}

// Staff-only manual re-attempt for an order stuck at 'confirmed' after a
// failed (or never-attempted) sync -- there's no automatic retry, so
// this is the only way to try again without re-flagging/re-clearing as
// a workaround.
async function retrySync(req, orderId) {
  requireStaff(req);
  const order = await fetchOrder(orderId);

  if (order.status !== 'confirmed') {
    throw new ApiError(409, `Only 'confirmed' orders can be retried (this order is '${order.status}')`);
  }

  const synced = await syncOrderToCin7(order);
  await logEvent(orderId, req.user.id, 'sync_retried', null);
  return sanitizeOrder(synced || order, req.roles.isPortalAdmin);
}

// pending -> confirmed. "Confirmed" = a client-admin has approved the
// order on their side. Triggers a Cin7 sync attempt immediately unless
// the order is flagged for review (integrations/cin7/sync.js checks
// the flag itself and skips if set).
async function confirmOrder(req, orderId) {
  const order = await fetchOrder(orderId);

  if (!PRE_CONFIRM_STATUSES.includes(order.status)) {
    throw new ApiError(409, `Order cannot be confirmed from its current status (${order.status})`);
  }

  const canApprove = await checkCanApprove(req.supabaseUser, order.store_id);
  if (!canApprove) throw new ApiError(403, 'You do not have approval rights for this store');

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('orders')
    .update({ status: 'confirmed', approved_by: req.user.id })
    .eq('id', orderId)
    .select()
    .single();
  if (updateErr) throw new ApiError(500, 'Failed to confirm order', updateErr.message);

  await logEvent(orderId, req.user.id, 'confirmed', null);

  const synced = await syncOrderToCin7(updated);
  return sanitizeOrder(synced || updated, req.roles.isPortalAdmin);
}

// Bulk confirm -- lets a client-admin/store-admin approve several
// pending orders in one action instead of opening each one. Same
// per-order access/precondition checks as confirmOrder, just looped;
// one order failing (wrong status, no approval rights, sync problem)
// doesn't block the others -- each gets its own outcome.
async function bulkConfirm(req) {
  const orderIds = req.body?.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    throw new ApiError(400, 'order_ids must be a non-empty array');
  }

  const { data: orders, error } = await supabaseAdmin.from('orders').select('*').in('id', orderIds);
  if (error) throw new ApiError(500, 'Failed to load orders', error.message);

  const notFound = orderIds.filter((id) => !orders.some((o) => o.id === id));
  const confirmed = [];
  const skipped = [];

  for (const order of orders) {
    if (!PRE_CONFIRM_STATUSES.includes(order.status)) {
      skipped.push({ id: order.id, reason: `not pending (currently ${order.status})` });
      continue;
    }

    const canApprove = await checkCanApprove(req.supabaseUser, order.store_id);
    if (!canApprove) {
      skipped.push({ id: order.id, reason: 'no approval rights for this store' });
      continue;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update({ status: 'confirmed', approved_by: req.user.id })
      .eq('id', order.id)
      .select()
      .single();
    if (updateErr) {
      skipped.push({ id: order.id, reason: updateErr.message });
      continue;
    }

    await logEvent(order.id, req.user.id, 'confirmed', { bulk: true });
    const synced = await syncOrderToCin7(updated);
    confirmed.push(sanitizeOrder(synced || updated, req.roles.isPortalAdmin));
  }

  return { confirmed, skipped, not_found: notFound };
}

// Pre-confirm decline by the approving client-admin/store-admin. Same
// access check and precondition as confirming, different outcome.
async function rejectOrder(req, orderId) {
  const order = await fetchOrder(orderId);

  if (!PRE_CONFIRM_STATUSES.includes(order.status)) {
    throw new ApiError(409, `Order cannot be rejected from its current status (${order.status})`);
  }

  const canApprove = await checkCanApprove(req.supabaseUser, order.store_id);
  if (!canApprove) throw new ApiError(403, 'You do not have approval rights for this store');

  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('orders')
    .update({ status: 'rejected' })
    .eq('id', orderId)
    .select()
    .single();
  if (updateErr) throw new ApiError(500, 'Failed to reject order', updateErr.message);

  await logEvent(orderId, req.user.id, 'rejected', reason ? { reason } : null);

  return sanitizeOrder(updated, req.roles.isPortalAdmin);
}

// Manual "Flag for Review" -- Shonrei staff only, on any order before
// it's synced. Not a rules engine, just a hold a human sets/clears.
async function flagOrder(req, orderId) {
  requireStaff(req);
  const order = await fetchOrder(orderId);

  if (!FLAGGABLE_STATUSES.includes(order.status)) {
    throw new ApiError(409, `Order cannot be flagged from its current status (${order.status})`);
  }

  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;

  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update({ flagged_for_review: true, flagged_reason: reason, flagged_by: req.user.id, reviewed_by: null, reviewed_at: null })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new ApiError(500, 'Failed to flag order', error.message);

  await logEvent(orderId, req.user.id, 'flagged_for_review', reason ? { reason } : null);

  return sanitizeOrder(updated, req.roles.isPortalAdmin);
}

// Clears the hold. If the order was already confirmed (i.e. it would
// have synced already if not for the flag), this triggers the
// deferred sync attempt -- mirrors how confirming triggers it normally.
async function clearFlag(req, orderId) {
  requireStaff(req);
  const order = await fetchOrder(orderId);

  if (!order.flagged_for_review) {
    throw new ApiError(409, 'Order is not currently flagged for review');
  }

  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update({ flagged_for_review: false, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new ApiError(500, 'Failed to clear review flag', error.message);

  await logEvent(orderId, req.user.id, 'review_cleared', null);

  if (updated.status === 'confirmed') {
    const synced = await syncOrderToCin7(updated);
    return sanitizeOrder(synced || updated, req.roles.isPortalAdmin);
  }

  return sanitizeOrder(updated, req.roles.isPortalAdmin);
}

// Bulk "Mark as Shipped" -- Shonrei staff only, only from in_progress.
// Primary path for the shipped status (see integrations/cin7/statusMapping.js
// for the auto_invoice fallback).
async function markShipped(req) {
  requireStaff(req);
  const orderIds = req.body?.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    throw new ApiError(400, 'order_ids must be a non-empty array');
  }

  const { data: orders, error } = await supabaseAdmin.from('orders').select('*').in('id', orderIds);
  if (error) throw new ApiError(500, 'Failed to load orders', error.message);

  const shippable = orders.filter((o) => o.status === 'in_progress');
  const skipped = orders.filter((o) => o.status !== 'in_progress').map((o) => ({ id: o.id, status: o.status }));
  const notFound = orderIds.filter((id) => !orders.some((o) => o.id === id));

  if (shippable.length === 0) {
    return { shipped: [], skipped, not_found: notFound };
  }

  const shippedAt = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('orders')
    .update({ status: 'shipped', shipped_at: shippedAt, shipped_source: 'manual', shipped_by: req.user.id })
    .in(
      'id',
      shippable.map((o) => o.id)
    )
    .select();
  if (updateErr) throw new ApiError(500, 'Failed to mark orders shipped', updateErr.message);

  await Promise.all(shippable.map((o) => logEvent(o.id, req.user.id, 'shipped', { source: 'manual' })));

  return {
    shipped: updated.map((o) => sanitizeOrder(o, req.roles.isPortalAdmin)),
    skipped,
    not_found: notFound,
  };
}

// Post-confirm/post-sync cancellation request. Pre-sync self-service
// cancel is a plain delete (see deleteOrder) -- this is for orders
// already past that point, where an admin must not be able to just
// delete them.
async function requestCancellation(req, orderId) {
  const order = await fetchOrder(orderId);

  const hasAccess = await checkStoreAccess(req.supabaseUser, order.store_id);
  if (!hasAccess) throw new ApiError(403, 'You do not have access to this order');

  if (PRE_SYNC_STATUSES.includes(order.status)) {
    throw new ApiError(409, 'This order has not synced yet -- delete it directly instead of requesting cancellation');
  }
  if (order.cancellation_status === 'requested') {
    throw new ApiError(409, 'A cancellation request is already pending for this order');
  }

  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;

  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update({
      cancellation_status: 'requested',
      cancellation_requested_at: new Date().toISOString(),
      cancellation_requested_by: req.user.id,
      cancellation_reason: reason,
      cancellation_resolved_at: null,
      cancellation_resolved_by: null,
    })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new ApiError(500, 'Failed to request cancellation', error.message);

  await logEvent(orderId, req.user.id, 'cancellation_requested', reason ? { reason } : null);

  return sanitizeOrder(updated, req.roles.isPortalAdmin);
}

// Shonrei staff review of a cancellation request. Approving here only
// updates our own records -- it does not (yet) void the Sale in Cin7;
// that's a follow-up, not built in this pass.
async function resolveCancellation(req, orderId) {
  requireStaff(req);
  const order = await fetchOrder(orderId);

  if (order.cancellation_status !== 'requested') {
    throw new ApiError(409, 'Order has no pending cancellation request');
  }

  const approve = req.body?.approve;
  if (typeof approve !== 'boolean') throw new ApiError(400, 'approve (boolean) is required');

  const { data: updated, error } = await supabaseAdmin
    .from('orders')
    .update({
      cancellation_status: approve ? 'approved' : 'denied',
      cancellation_resolved_at: new Date().toISOString(),
      cancellation_resolved_by: req.user.id,
    })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new ApiError(500, 'Failed to resolve cancellation', error.message);

  await logEvent(orderId, req.user.id, approve ? 'cancellation_approved' : 'cancellation_denied', null);

  return sanitizeOrder(updated, req.roles.isPortalAdmin);
}

// Pre-sync self-service delete. Once an order has reached in_progress
// (i.e. it's synced to Cin7) this must be refused -- use
// requestCancellation instead.
async function deleteOrder(req, orderId) {
  const order = await fetchOrder(orderId);

  const hasAccess = await checkStoreAccess(req.supabaseUser, order.store_id);
  if (!hasAccess) throw new ApiError(403, 'You do not have access to this order');

  if (!PRE_SYNC_STATUSES.includes(order.status)) {
    throw new ApiError(409, 'This order has already synced -- request a cancellation instead of deleting it');
  }

  const { error } = await supabaseAdmin.from('orders').delete().eq('id', orderId);
  if (error) throw new ApiError(500, 'Failed to delete order', error.message);
}

module.exports = {
  createOrder,
  listOrders,
  getOrder,
  confirmOrder,
  rejectOrder,
  flagOrder,
  clearFlag,
  markShipped,
  requestCancellation,
  resolveCancellation,
  deleteOrder,
  retrySync,
  bulkConfirm,
};
