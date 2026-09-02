const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');

// Staff CRUD for client_product_skus (010) -- a client's own reference
// code for a shared product, e.g. shown in the Catalog "Client SKU"
// column and printed on their own paperwork. No client-side write RLS
// (010's comment: "assumed Shonrei-staff-managed for now") -- same
// staff-only-via-backend convention as everything else here.

function requireStaff(req) {
  if (!req.roles.isPortalAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei staff');
  }
}

function requireIds(clientId, productId) {
  if (!clientId || typeof clientId !== 'string') throw new ApiError(400, 'client_id is required');
  if (productId !== undefined && (!productId || typeof productId !== 'string')) throw new ApiError(400, 'product_id is required');
}

async function listForClient(req, clientId) {
  requireStaff(req);
  requireIds(clientId);
  const { data, error } = await supabaseAdmin.from('client_product_skus').select('client_id, product_id, client_sku').eq('client_id', clientId);
  if (error) throw new ApiError(500, 'Failed to list client product SKUs', error.message);
  return data;
}

async function upsertSku(req, clientId, productId, clientSku) {
  requireStaff(req);
  requireIds(clientId, productId);
  const sku = typeof clientSku === 'string' ? clientSku.trim() : '';
  if (!sku) throw new ApiError(400, 'client_sku is required');

  const { data, error } = await supabaseAdmin
    .from('client_product_skus')
    .upsert({ client_id: clientId, product_id: productId, client_sku: sku }, { onConflict: 'client_id,product_id' })
    .select('client_id, product_id, client_sku')
    .single();
  if (error) throw new ApiError(500, 'Failed to save client SKU', error.message);
  return data;
}

async function removeSku(req, clientId, productId) {
  requireStaff(req);
  requireIds(clientId, productId);
  const { error } = await supabaseAdmin.from('client_product_skus').delete().eq('client_id', clientId).eq('product_id', productId);
  if (error) throw new ApiError(500, 'Failed to remove client SKU', error.message);
}

module.exports = { listForClient, upsertSku, removeSku };
