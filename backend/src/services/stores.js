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

  let query = supabaseAdmin.from('stores').select('id, name, store_number, client_id, client_address_id, clients(name)').order('name');

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

// Which of the client's synced Cin7 addresses (014) this store ships
// to (027) -- same permission shape as updateStoreNumber above.
// clientAddressId may be null (clears the assignment, falls back to
// the client's default address).
async function updateClientAddress(req, storeId, clientAddressId) {
  const { isPortalAdmin, clientRoles } = req.roles;

  const { data: store, error: storeErr } = await supabaseAdmin.from('stores').select('id, client_id').eq('id', storeId).maybeSingle();
  if (storeErr) throw new ApiError(500, 'Failed to load store', storeErr.message);
  if (!store) throw new ApiError(404, 'Store not found');

  const isClientAdminOfThisStore = clientRoles.some((r) => r.client_id === store.client_id);
  if (!isPortalAdmin && !isClientAdminOfThisStore) {
    throw new ApiError(403, 'You do not have permission to edit this store');
  }

  if (clientAddressId !== null && typeof clientAddressId !== 'string') {
    throw new ApiError(400, 'client_address_id must be a string or null');
  }

  // Guard against assigning an address that belongs to a different
  // client -- a store-scoped permission check above isn't enough on
  // its own to stop that.
  if (clientAddressId) {
    const { data: address, error: addressErr } = await supabaseAdmin
      .from('client_addresses')
      .select('id, client_id')
      .eq('id', clientAddressId)
      .maybeSingle();
    if (addressErr) throw new ApiError(500, 'Failed to load address', addressErr.message);
    if (!address || address.client_id !== store.client_id) {
      throw new ApiError(400, 'That address does not belong to this store\'s client');
    }
  }

  const { data, error } = await supabaseAdmin
    .from('stores')
    .update({ client_address_id: clientAddressId })
    .eq('id', storeId)
    .select('id, name, store_number, client_id, client_address_id')
    .single();
  if (error) throw new ApiError(500, 'Failed to update store address', error.message);
  return data;
}

// Bulk store<->Cin7-address matching from a client-supplied sheet
// (store number + free-text address, no stable Cin7 ID to key off --
// unlike our own export below). Text-matches each row's address
// against this client's already-synced client_addresses.line1 (case-
// insensitive substring, either direction, since a client's own
// spreadsheet formatting won't exactly match Cin7's). Never guesses on
// an ambiguous/missing match -- reports it instead so staff resolve it
// by hand in the "Ship-to address" dropdown.
async function importAddressMatches(req, clientId, rows) {
  const { isPortalAdmin, clientRoles } = req.roles;
  if (!clientId || typeof clientId !== 'string') throw new ApiError(400, 'client_id is required');
  const isClientAdminOfThisClient = clientRoles.some((r) => r.client_id === clientId);
  if (!isPortalAdmin && !isClientAdminOfThisClient) {
    throw new ApiError(403, 'You do not have permission to manage stores for this client');
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'rows must be a non-empty array');

  const { data: stores, error: storesErr } = await supabaseAdmin.from('stores').select('id, store_number').eq('client_id', clientId);
  if (storesErr) throw new ApiError(500, 'Failed to load stores', storesErr.message);
  const { data: addresses, error: addrErr } = await supabaseAdmin.from('client_addresses').select('id, line1').eq('client_id', clientId);
  if (addrErr) throw new ApiError(500, 'Failed to load addresses', addrErr.message);

  const matched = [];
  const unmatched = [];

  for (const row of rows) {
    const storeNumber = String(row?.store_number ?? '').trim();
    const addressText = String(row?.address ?? '').trim();
    if (!storeNumber || !addressText) {
      unmatched.push({ store_number: storeNumber, reason: 'missing store_number or address' });
      continue;
    }

    const store = stores.find((s) => (s.store_number || '').trim().toLowerCase() === storeNumber.toLowerCase());
    if (!store) {
      unmatched.push({ store_number: storeNumber, reason: 'no store with this store_number' });
      continue;
    }

    const needle = addressText.toLowerCase();
    const candidates = addresses.filter((a) => {
      const line1 = (a.line1 || '').toLowerCase();
      return line1.includes(needle) || needle.includes(line1);
    });
    if (candidates.length === 0) {
      unmatched.push({ store_number: storeNumber, reason: `no synced address matches "${addressText}"` });
      continue;
    }
    if (candidates.length > 1) {
      unmatched.push({ store_number: storeNumber, reason: `"${addressText}" matches ${candidates.length} synced addresses -- ambiguous, assign manually` });
      continue;
    }

    const { error: updateErr } = await supabaseAdmin.from('stores').update({ client_address_id: candidates[0].id }).eq('id', store.id);
    if (updateErr) {
      unmatched.push({ store_number: storeNumber, reason: updateErr.message });
      continue;
    }
    matched.push({ store_number: storeNumber, store_id: store.id, client_address_id: candidates[0].id });
  }

  return { matched, unmatched };
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

module.exports = { listManageableStores, updateStoreNumber, updateClientAddress, importAddressMatches, createStore };
