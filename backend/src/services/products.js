const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');
const { syncProducts } = require('../integrations/cin7/productSync');

// Reads (both the buyer catalog and the staff curation search) go
// straight through Supabase + RLS, not this API -- 011's SELECT
// policy already scopes non-staff to added_to_portal products and
// lets staff see the full mirror. Only the write actions below need
// the backend, same reasoning as everything else: staff-only business
// rules that RLS alone can't express.

function requireStaff(req) {
  if (!req.roles.isPortalAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei staff');
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

async function addToPortal(req, productId) {
  requireStaff(req);
  const { data, error } = await supabaseAdmin.from('products').update({ added_to_portal: true }).eq('id', productId).select().maybeSingle();
  if (error) throw new ApiError(500, 'Failed to add product to portal', error.message);
  if (!data) throw new ApiError(404, 'Product not found');
  return data;
}

async function removeFromPortal(req, productId) {
  requireStaff(req);
  const { data, error } = await supabaseAdmin.from('products').update({ added_to_portal: false }).eq('id', productId).select().maybeSingle();
  if (error) throw new ApiError(500, 'Failed to remove product from portal', error.message);
  if (!data) throw new ApiError(404, 'Product not found');
  return data;
}

async function bulkAddToPortal(req) {
  requireStaff(req);
  const ids = req.body?.product_ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, 'product_ids must be a non-empty array');
  }
  const { data, error } = await supabaseAdmin.from('products').update({ added_to_portal: true }).in('id', ids).select();
  if (error) throw new ApiError(500, 'Failed to bulk add products to portal', error.message);
  return { updated: data };
}

module.exports = { runSync, addToPortal, removeFromPortal, bulkAddToPortal };
