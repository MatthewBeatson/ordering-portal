const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');
const { syncOrderToCin7 } = require('./cin7');

const APPROVABLE_STATUSES = ['draft', 'pending_approval'];

// Calls the same has_store_access()/can_approve() Postgres functions the
// RLS policies use, via RPC on a client scoped to the requesting user's own
// JWT (so auth.uid() resolves correctly). This is deliberate: one
// authorization implementation (in SQL), not a second copy in JS that could
// silently drift from what RLS actually enforces.
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

  const status = body?.status ?? 'pending_approval';
  if (!APPROVABLE_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${APPROVABLE_STATUSES.join(', ')}`);
  }

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

  return { storeId, status, notes: body.notes ?? null, lines };
}

async function createOrder(req) {
  const { storeId, status, notes, lines } = validateCreateInput(req.body);

  // Never trust a client-supplied store_id blindly — check it against this
  // user's actual roles before touching the database.
  const hasAccess = await checkStoreAccess(req.supabaseUser, storeId);
  if (!hasAccess) {
    throw new ApiError(403, 'You do not have access to this store');
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .insert({ store_id: storeId, requested_by: req.user.id, status, notes })
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

  await supabaseAdmin
    .from('order_events')
    .insert({ order_id: order.id, actor_id: req.user.id, event_type: 'created', detail: { status } });

  return { ...order, order_lines: orderLines };
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

  return { orders: data, total: count, limit, offset };
}

async function getOrder(req, orderId) {
  const { data: order, error } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).maybeSingle();

  if (error) {
    if (isInvalidUuidError(error)) throw new ApiError(400, 'Invalid order id');
    throw new ApiError(500, 'Failed to fetch order', error.message);
  }
  if (!order) throw new ApiError(404, 'Order not found');

  const hasAccess = await checkStoreAccess(req.supabaseUser, order.store_id);
  if (!hasAccess) throw new ApiError(403, 'You do not have access to this order');

  const { data: lines, error: linesErr } = await supabaseAdmin
    .from('order_lines')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  if (linesErr) throw new ApiError(500, 'Failed to fetch order lines', linesErr.message);

  return { ...order, order_lines: lines };
}

async function transitionOrder(req, orderId, { toStatus, eventType, extraDetail }) {
  const { data: order, error } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).maybeSingle();

  if (error) {
    if (isInvalidUuidError(error)) throw new ApiError(400, 'Invalid order id');
    throw new ApiError(500, 'Failed to fetch order', error.message);
  }
  if (!order) throw new ApiError(404, 'Order not found');

  if (!APPROVABLE_STATUSES.includes(order.status)) {
    throw new ApiError(409, `Order cannot transition to ${toStatus} from its current status (${order.status})`);
  }

  const canApprove = await checkCanApprove(req.supabaseUser, order.store_id);
  if (!canApprove) throw new ApiError(403, 'You do not have approval rights for this store');

  const updatePayload = { status: toStatus };
  if (toStatus === 'approved') updatePayload.approved_by = req.user.id;

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('orders')
    .update(updatePayload)
    .eq('id', orderId)
    .select()
    .single();

  if (updateErr) throw new ApiError(500, `Failed to update order`, updateErr.message);

  await supabaseAdmin.from('order_events').insert({
    order_id: orderId,
    actor_id: req.user.id,
    event_type: eventType,
    detail: extraDetail ?? null,
  });

  return updated;
}

async function approveOrder(req, orderId) {
  const updated = await transitionOrder(req, orderId, { toStatus: 'approved', eventType: 'approved' });
  // syncOrderToCin7 never throws -- a sync failure doesn't undo the
  // approval, which already succeeded. It's recorded on the order
  // (status/cin7_sync_error) instead. Return its result so the response
  // reflects the real final state (synced_to_cin7/sync_failed), not the
  // stale 'approved' snapshot from before sync ran.
  return (await syncOrderToCin7(updated)) || updated;
}

async function rejectOrder(req, orderId) {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  return transitionOrder(req, orderId, { toStatus: 'rejected', eventType: 'rejected', extraDetail: reason ? { reason } : null });
}

module.exports = { createOrder, listOrders, getOrder, approveOrder, rejectOrder };
