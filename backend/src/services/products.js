const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');
const { syncProducts } = require('../integrations/cin7/productSync');

// Reads (both the buyer catalog and the staff curation search) go
// straight through Supabase + RLS, not this API -- 013's SELECT policy
// (product_visible_to_user, keyed off client_portal_products) already
// scopes non-staff to whatever's been curated for their own client(s),
// and lets staff see the full mirror. Only the write actions below need
// the backend, same reasoning as everything else: staff-only business
// rules that RLS alone can't express.

function requireStaff(req) {
  if (!req.roles.isPortalAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei staff');
  }
}

function requireClientId(clientId) {
  if (!clientId || typeof clientId !== 'string') {
    throw new ApiError(400, 'client_id is required');
  }
}

async function runSync(req) {
  requireStaff(req);
  try {
    return await syncProducts();
  } catch (err) {
    throw new ApiError(502, 'Cin7 product sync failed', err.message);
  }
}

async function addToPortal(req, productId, clientId) {
  requireStaff(req);
  requireClientId(clientId);
  const { error } = await supabaseAdmin
    .from('client_portal_products')
    .upsert({ client_id: clientId, product_id: productId, added_by: req.user.id }, { onConflict: 'client_id,product_id' });
  if (error) throw new ApiError(500, 'Failed to add product to portal', error.message);
  return { client_id: clientId, product_id: productId, added_to_portal: true };
}

async function removeFromPortal(req, productId, clientId) {
  requireStaff(req);
  requireClientId(clientId);
  const { error } = await supabaseAdmin
    .from('client_portal_products')
    .delete()
    .eq('client_id', clientId)
    .eq('product_id', productId);
  if (error) throw new ApiError(500, 'Failed to remove product from portal', error.message);
  return { client_id: clientId, product_id: productId, added_to_portal: false };
}

async function bulkAddToPortal(req) {
  requireStaff(req);
  const ids = req.body?.product_ids;
  const clientId = req.body?.client_id;
  requireClientId(clientId);
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, 'product_ids must be a non-empty array');
  }
  const rows = ids.map((productId) => ({ client_id: clientId, product_id: productId, added_by: req.user.id }));
  const { data, error } = await supabaseAdmin
    .from('client_portal_products')
    .upsert(rows, { onConflict: 'client_id,product_id' })
    .select();
  if (error) throw new ApiError(500, 'Failed to bulk add products to portal', error.message);
  return { client_id: clientId, added: data };
}

module.exports = { runSync, addToPortal, removeFromPortal, bulkAddToPortal };
