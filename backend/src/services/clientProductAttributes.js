const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');

// Staff CRUD for client_product_attributes (022, extended by 024) --
// per-(client, product) overrides for jewellery_count/product_type/
// jewellery_type/colour. No client-side write RLS on this table by
// design (see 013_per_client_portal_products.sql's comment, the
// established convention for every staff-managed table in this repo)
// -- all writes go through here, gated by requireStaff.

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
  const { data, error } = await supabaseAdmin.from('client_product_attributes').select('*').eq('client_id', clientId);
  if (error) throw new ApiError(500, 'Failed to list client product attributes', error.message);
  return data;
}

// Always upserts the full 4-field object (jewellery_count,
// product_type_id, jewellery_type_id, colour_id) rather than a partial
// patch -- avoids ambiguity between "field not sent" and "field
// explicitly cleared to null." The curation UI always shows/saves all
// four fields for a product at once.
async function upsertOverride(req, clientId, productId, input) {
  requireStaff(req);
  requireIds(clientId, productId);

  const jewelleryCount = input?.jewellery_count;
  if (jewelleryCount != null && (!Number.isInteger(jewelleryCount) || jewelleryCount < 0)) {
    throw new ApiError(400, 'jewellery_count must be a non-negative integer or null');
  }

  const row = {
    client_id: clientId,
    product_id: productId,
    jewellery_count: jewelleryCount ?? null,
    product_type_id: input?.product_type_id ?? null,
    jewellery_type_id: input?.jewellery_type_id ?? null,
    colour_id: input?.colour_id ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('client_product_attributes')
    .upsert(row, { onConflict: 'client_id,product_id' })
    .select()
    .single();
  if (error) throw new ApiError(500, 'Failed to save product attribute override', error.message);
  return data;
}

async function removeOverride(req, clientId, productId) {
  requireStaff(req);
  requireIds(clientId, productId);
  const { error } = await supabaseAdmin.from('client_product_attributes').delete().eq('client_id', clientId).eq('product_id', productId);
  if (error) throw new ApiError(500, 'Failed to remove product attribute override', error.message);
}

module.exports = { listForClient, upsertOverride, removeOverride };
