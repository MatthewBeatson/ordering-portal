const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');

// Staff-only writes to custom_group_rules (030) -- the tray -> ordered-
// inserts pairs behind Catalog/Cart/Order Detail's "Custom" grouping
// mode. Reads go straight through Supabase + RLS (any authenticated
// user, same as every other taxonomy table) -- only writes need the
// backend. One tray's rule set is always managed as a whole (full
// replace), same reasoning as productDisplaySystems.setForProduct --
// the admin screen shows a tray's current ordered insert list and
// submits the final set, not incremental add/remove.

function requireStaff(req) {
  if (!req.roles.isPortalAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei staff');
  }
}

// Every rule, joined with both products' sku/name for the admin
// screen's listing -- grouped client-side by tray_product_id there.
async function list(req) {
  requireStaff(req);
  const { data, error } = await supabaseAdmin
    .from('custom_group_rules')
    .select(
      'id, tray_product_id, insert_product_id, display_order, tray:products!custom_group_rules_tray_product_id_fkey(id, sku, name), insert:products!custom_group_rules_insert_product_id_fkey(id, sku, name)'
    )
    .order('display_order');
  if (error) throw new ApiError(500, 'Failed to load custom group rules', error.message);
  return data;
}

// A rule must only ever reference something actually on a portal --
// enforced here, not just in the frontend's picker (which only
// controls what a fresh page load offers; it can't stop a stale
// cached page or a direct API call). Real incident that prompted this:
// two Cin7 products share the exact same name/description (a genuine
// Cin7-side near-duplicate, e.g. "M150HBUSWL" vs "M150HBUSWLPR" both
// showing "...9271513") -- one was curated, one wasn't, and the
// uncurated one got picked and saved before this check existed.
async function assertOnPortal(productIds) {
  if (productIds.length === 0) return;
  const { data, error } = await supabaseAdmin.from('client_portal_products').select('product_id').in('product_id', productIds);
  if (error) throw new ApiError(500, 'Failed to verify products are curated', error.message);
  const curated = new Set((data || []).map((r) => r.product_id));
  const notCurated = productIds.filter((id) => !curated.has(id));
  if (notCurated.length > 0) {
    throw new ApiError(400, `Product(s) not curated onto any client's portal: ${notCurated.join(', ')}`);
  }
}

async function setForTray(req, trayProductId, insertProductIds) {
  requireStaff(req);
  if (!trayProductId || typeof trayProductId !== 'string') throw new ApiError(400, 'tray_product_id is required');
  if (!Array.isArray(insertProductIds)) throw new ApiError(400, 'insert_product_ids must be an array');
  if (insertProductIds.includes(trayProductId)) throw new ApiError(400, 'A tray cannot be its own insert');
  await assertOnPortal([trayProductId, ...new Set(insertProductIds)]);

  const { error: deleteErr } = await supabaseAdmin.from('custom_group_rules').delete().eq('tray_product_id', trayProductId);
  if (deleteErr) throw new ApiError(500, 'Failed to update custom group rules', deleteErr.message);

  if (insertProductIds.length === 0) return { tray_product_id: trayProductId, insert_product_ids: [] };

  const rows = insertProductIds.map((insertProductId, i) => ({
    tray_product_id: trayProductId,
    insert_product_id: insertProductId,
    display_order: i,
  }));
  const { error: insertErr } = await supabaseAdmin.from('custom_group_rules').insert(rows);
  if (insertErr) throw new ApiError(500, 'Failed to update custom group rules', insertErr.message);
  return { tray_product_id: trayProductId, insert_product_ids: insertProductIds };
}

async function removeTray(req, trayProductId) {
  requireStaff(req);
  const { error } = await supabaseAdmin.from('custom_group_rules').delete().eq('tray_product_id', trayProductId);
  if (error) throw new ApiError(500, 'Failed to remove custom group rule', error.message);
  return { ok: true };
}

module.exports = { list, setForTray, removeTray };
