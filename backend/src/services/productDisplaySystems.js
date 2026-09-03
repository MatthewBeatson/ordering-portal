const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');

// Staff-only writes to product_display_systems (028) -- the many-to-
// many join between products and display_systems, portal-native (no
// longer Cin7 Category-sourced). Reads go straight through Supabase +
// RLS (any authenticated user, same as the other taxonomy tables) --
// only writes need the backend.

function requireStaff(req) {
  if (!req.roles.isPortalAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei staff');
  }
}

function requireIds(productId, displaySystemIds) {
  if (!productId || typeof productId !== 'string') throw new ApiError(400, 'product_id is required');
  if (!Array.isArray(displaySystemIds)) throw new ApiError(400, 'display_system_ids must be an array');
}

// Full replace for ONE product -- the per-product editor shows a
// multi-select of everything the product currently belongs to and
// submits the final set, so "replace" (not incremental add/remove) is
// the right semantics here.
async function setForProduct(req, productId, displaySystemIds) {
  requireStaff(req);
  requireIds(productId, displaySystemIds);

  const { error: deleteErr } = await supabaseAdmin.from('product_display_systems').delete().eq('product_id', productId);
  if (deleteErr) throw new ApiError(500, 'Failed to update display systems', deleteErr.message);

  if (displaySystemIds.length === 0) return { product_id: productId, display_system_ids: [] };

  const rows = displaySystemIds.map((displaySystemId) => ({ product_id: productId, display_system_id: displaySystemId }));
  const { error: insertErr } = await supabaseAdmin.from('product_display_systems').insert(rows);
  if (insertErr) throw new ApiError(500, 'Failed to update display systems', insertErr.message);
  return { product_id: productId, display_system_ids: displaySystemIds };
}

// Bulk ADD (union) -- a bulk action across many selected products
// should add a system without disturbing whatever else each product
// already belongs to, unlike the single-product editor's full replace.
async function bulkAdd(req, productIds, displaySystemIds) {
  requireStaff(req);
  if (!Array.isArray(productIds) || productIds.length === 0) throw new ApiError(400, 'product_ids must be a non-empty array');
  if (!Array.isArray(displaySystemIds) || displaySystemIds.length === 0) throw new ApiError(400, 'display_system_ids must be a non-empty array');

  const rows = [];
  for (const productId of productIds) {
    for (const displaySystemId of displaySystemIds) {
      rows.push({ product_id: productId, display_system_id: displaySystemId });
    }
  }
  const { error } = await supabaseAdmin.from('product_display_systems').upsert(rows, { onConflict: 'product_id,display_system_id', ignoreDuplicates: true });
  if (error) throw new ApiError(500, 'Failed to bulk-add display systems', error.message);
  return { added: rows.length };
}

// Bulk REMOVE -- the inverse, for "these shouldn't be tagged X anymore".
async function bulkRemove(req, productIds, displaySystemIds) {
  requireStaff(req);
  if (!Array.isArray(productIds) || productIds.length === 0) throw new ApiError(400, 'product_ids must be a non-empty array');
  if (!Array.isArray(displaySystemIds) || displaySystemIds.length === 0) throw new ApiError(400, 'display_system_ids must be a non-empty array');

  const { error } = await supabaseAdmin
    .from('product_display_systems')
    .delete()
    .in('product_id', productIds)
    .in('display_system_id', displaySystemIds);
  if (error) throw new ApiError(500, 'Failed to bulk-remove display systems', error.message);
  return { ok: true };
}

module.exports = { setForProduct, bulkAdd, bulkRemove };
