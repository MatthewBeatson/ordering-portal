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

// A client-admin can only create a store under their OWN client(s) --
// never trust a client-supplied client_id blindly, same reasoning as
// checkStoreAccess elsewhere. cin7_address_line1 is required (not just
// name/store_number) because sync.js refuses to sync any order for a
// store that has no pinned address at all -- better to catch that at
// creation than leave a store nobody can ever actually order through.
async function createStore(req, input) {
  const { isPortalAdmin, clientRoles } = req.roles;

  const clientId = input?.client_id;
  if (!clientId || typeof clientId !== 'string') throw new ApiError(400, 'client_id is required');

  const isClientAdminOfThisClient = clientRoles.some((r) => r.client_id === clientId);
  if (!isPortalAdmin && !isClientAdminOfThisClient) {
    throw new ApiError(403, 'You do not have permission to add a store for this client');
  }

  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ApiError(400, 'name is required');

  const line1 = typeof input?.cin7_address_line1 === 'string' ? input.cin7_address_line1.trim() : '';
  if (!line1) throw new ApiError(400, 'An address (at least line 1) is required so orders for this store can sync to Cin7');

  const storeNumber = typeof input?.store_number === 'string' && input.store_number.trim() ? input.store_number.trim() : null;

  const { data, error } = await supabaseAdmin
    .from('stores')
    .insert({
      name,
      client_id: clientId,
      store_number: storeNumber,
      cin7_address_line1: line1,
      cin7_address_line2: input?.cin7_address_line2 || null,
      cin7_address_city: input?.cin7_address_city || null,
      cin7_address_state: input?.cin7_address_state || null,
      cin7_address_postcode: input?.cin7_address_postcode || null,
      cin7_address_country: input?.cin7_address_country || null,
      is_active: true,
    })
    .select('id, name, store_number, client_id')
    .single();

  if (error) {
    if (error.code === '23505') throw new ApiError(409, 'A store with this store number already exists for this client');
    throw new ApiError(500, 'Failed to create store', error.message);
  }
  return data;
}

module.exports = { listManageableStores, updateStoreNumber, createStore };
