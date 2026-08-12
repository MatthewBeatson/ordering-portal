const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');

// Reads go through Supabase + RLS directly, not this API -- only the
// write below needs the backend: stores has no client-side
// INSERT/UPDATE policy at all (same lockdown pattern as everywhere
// else), and "who can edit a store's reference number" is a business
// rule (client-admin of that store's own client, or Shonrei staff) RLS
// alone can't express cleanly.

async function listManageableStores(req) {
  const { isPortalAdmin, clientRoles } = req.roles;

  let query = supabaseAdmin.from('stores').select('id, name, store_number, client_id, clients(name)').order('name');

  if (!isPortalAdmin) {
    const clientIds = clientRoles.map((r) => r.client_id);
    if (clientIds.length === 0) {
      throw new ApiError(403, 'This action is restricted to client admins or Shonrei staff');
    }
    query = query.in('client_id', clientIds);
  }

  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Failed to list stores', error.message);
  return data;
}

async function updateStoreNumber(req, storeId, storeNumber) {
  const { isPortalAdmin, clientRoles } = req.roles;

  const { data: store, error: storeErr } = await supabaseAdmin.from('stores').select('id, client_id').eq('id', storeId).maybeSingle();
  if (storeErr) throw new ApiError(500, 'Failed to load store', storeErr.message);
  if (!store) throw new ApiError(404, 'Store not found');

  const isClientAdminOfThisStore = clientRoles.some((r) => r.client_id === store.client_id);
  if (!isPortalAdmin && !isClientAdminOfThisStore) {
    throw new ApiError(403, 'You do not have permission to edit this store');
  }

  if (typeof storeNumber !== 'string' || storeNumber.trim().length === 0) {
    throw new ApiError(400, 'store_number must be a non-empty string');
  }

  const { data, error } = await supabaseAdmin
    .from('stores')
    .update({ store_number: storeNumber.trim() })
    .eq('id', storeId)
    .select('id, name, store_number, client_id')
    .single();
  if (error) throw new ApiError(500, 'Failed to update store number', error.message);
  return data;
}

module.exports = { listManageableStores, updateStoreNumber };
