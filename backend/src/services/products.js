const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');
const { syncProducts } = require('../integrations/cin7/productSync');

const IMAGE_BUCKET = 'product-images';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

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

// Sets a product's own GLOBAL classification -- product_type_id/
// jewellery_type_id/colour_id (FKs) and jewellery_count (integer) on
// `products` itself, as distinct from a per-client override
// (client_product_attributes, see services/clientProductAttributes.js,
// which resolves as override-if-set-else-this-global-value for all
// four). Portal-native as of 023/026 -- no longer Cin7-sourced, so this
// is the only way these ever get set now. Partial update: only the
// keys actually present in input are touched, so the curation UI can
// change one field at a time.
const TAXONOMY_REF_FIELDS = ['product_type_id', 'jewellery_type_id', 'colour_id'];

async function updateTaxonomy(req, productId, input) {
  requireStaff(req);
  const patch = {};
  for (const field of TAXONOMY_REF_FIELDS) {
    if (field in (input || {})) patch[field] = input[field] || null;
  }
  if (input && 'jewellery_count' in input) {
    const count = input.jewellery_count;
    if (count != null && (!Number.isInteger(count) || count < 0)) {
      throw new ApiError(400, 'jewellery_count must be a non-negative integer or null');
    }
    patch.jewellery_count = count ?? null;
  }
  if (Object.keys(patch).length === 0) throw new ApiError(400, 'Nothing to update');

  const { data, error } = await supabaseAdmin
    .from('products')
    .update(patch)
    .eq('id', productId)
    .select('id, product_type_id, jewellery_type_id, colour_id, jewellery_count')
    .maybeSingle();
  if (error) throw new ApiError(500, 'Failed to update product classification', error.message);
  if (!data) throw new ApiError(404, 'Product not found');
  return data;
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

// Goes through the backend (service_role) deliberately -- the
// product-images Storage bucket has no client-side write policy at
// all (confirmed: zero policies on storage.objects for it), same
// lockdown reasoning as every other write in this app. Images append
// (a product can have several, product_images.display_order controls
// which shows first) rather than replacing whatever's already there.
async function uploadImage(req, productId) {
  requireStaff(req);
  const file = req.file;
  if (!file) throw new ApiError(400, 'No file uploaded (expected multipart field "file")');
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(400, `Image too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB)`);
  const ext = ALLOWED_IMAGE_EXT[file.mimetype];
  if (!ext) throw new ApiError(400, `Unsupported image type "${file.mimetype}" -- use JPEG, PNG, WEBP, or GIF`);

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('product_images')
    .select('display_order')
    .eq('product_id', productId)
    .order('display_order', { ascending: false })
    .limit(1);
  if (existingErr) throw new ApiError(500, 'Failed to check existing images', existingErr.message);
  const nextOrder = existing.length > 0 ? existing[0].display_order + 1 : 0;

  const storagePath = `${productId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadErr } = await supabaseAdmin.storage.from(IMAGE_BUCKET).upload(storagePath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (uploadErr) throw new ApiError(500, 'Failed to upload image', uploadErr.message);

  const { data: row, error: insertErr } = await supabaseAdmin
    .from('product_images')
    .insert({ product_id: productId, storage_path: storagePath, display_order: nextOrder })
    .select()
    .single();
  if (insertErr) {
    // Best-effort cleanup so a failed insert doesn't leave an orphaned
    // Storage object behind.
    await supabaseAdmin.storage.from(IMAGE_BUCKET).remove([storagePath]);
    throw new ApiError(500, 'Failed to save image record', insertErr.message);
  }
  return row;
}

async function deleteImage(req, imageId) {
  requireStaff(req);
  const { data: image, error: fetchErr } = await supabaseAdmin.from('product_images').select('id, storage_path').eq('id', imageId).maybeSingle();
  if (fetchErr) throw new ApiError(500, 'Failed to load image', fetchErr.message);
  if (!image) throw new ApiError(404, 'Image not found');

  const { error: deleteRowErr } = await supabaseAdmin.from('product_images').delete().eq('id', imageId);
  if (deleteRowErr) throw new ApiError(500, 'Failed to delete image record', deleteRowErr.message);

  // Not fatal if this fails -- the DB row (what controls display) is
  // already gone; a leftover Storage object is wasted space, not a
  // correctness problem.
  const { error: removeErr } = await supabaseAdmin.storage.from(IMAGE_BUCKET).remove([image.storage_path]);
  if (removeErr) console.error(`[products] failed to remove storage object ${image.storage_path}:`, removeErr.message);
}

module.exports = { runSync, addToPortal, removeFromPortal, bulkAddToPortal, uploadImage, deleteImage, updateTaxonomy };
