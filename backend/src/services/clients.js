const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');
const { syncClientAddresses } = require('../integrations/cin7/addressSync');

function requireStaff(req) {
  if (!req.roles.isPortalAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei staff');
  }
}

// Stricter than requireStaff -- pricing visibility is deliberately
// super-admin-only (confirmed with the client), same gating pattern as
// services/staff.js.
function requireSuperAdmin(req) {
  if (!req.roles.isSuperAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei super admins');
  }
}

async function updateShowPricing(req, clientId, showPricing) {
  requireSuperAdmin(req);
  if (!clientId || typeof clientId !== 'string') throw new ApiError(400, 'client_id is required');
  if (typeof showPricing !== 'boolean') throw new ApiError(400, 'show_pricing must be a boolean');

  const { data, error } = await supabaseAdmin
    .from('clients')
    .update({ show_pricing: showPricing })
    .eq('id', clientId)
    .select('id, name, show_pricing')
    .maybeSingle();
  if (error) throw new ApiError(500, 'Failed to update pricing visibility', error.message);
  if (!data) throw new ApiError(404, 'Client not found');
  return data;
}

async function syncAddresses(req, clientId) {
  requireStaff(req);
  try {
    return await syncClientAddresses(clientId);
  } catch (err) {
    throw new ApiError(502, 'Cin7 address sync failed', err.message);
  }
}

// Clients a client-admin/staff can manage stores under -- staff see
// every client (needed to onboard a new client's first store), a
// client-admin sees only their own client(s), even ones with zero
// stores yet.
async function listManageableClients(req) {
  const { isPortalAdmin, clientRoles } = req.roles;

  let query = supabaseAdmin.from('clients').select('id, name').order('name');
  if (!isPortalAdmin) {
    const clientIds = clientRoles.map((r) => r.client_id);
    if (clientIds.length === 0) throw new ApiError(403, 'This action is restricted to client admins or Shonrei staff');
    query = query.in('id', clientIds);
  }

  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Failed to list clients', error.message);
  return data;
}

// Every user with a role at this client -- either directly
// (user_client_roles, client_admin) or via one of its stores
// (user_store_roles, buyer/store_admin) -- staff-only, so staff can see
// who's ordering for a client and assign each login's own default
// shipping address (see setUserDefaultShippingAddress below; confirmed
// with the client 2026-09-09: this is a per-LOGIN default, e.g. a QLD
// admin's own login always defaults to the QLD head office regardless
// of which store number they're placing an order under).
async function listClientUsers(req, clientId) {
  requireStaff(req);

  const { data: clientRoleRows, error: crErr } = await supabaseAdmin.from('user_client_roles').select('user_id').eq('client_id', clientId);
  if (crErr) throw new ApiError(500, 'Failed to list client users', crErr.message);

  const { data: stores, error: storesErr } = await supabaseAdmin.from('stores').select('id, name').eq('client_id', clientId);
  if (storesErr) throw new ApiError(500, 'Failed to list client users', storesErr.message);
  const storeIds = stores.map((s) => s.id);
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]));

  let storeRoleRows = [];
  if (storeIds.length > 0) {
    const { data, error } = await supabaseAdmin.from('user_store_roles').select('user_id, store_id, role').in('store_id', storeIds);
    if (error) throw new ApiError(500, 'Failed to list client users', error.message);
    storeRoleRows = data;
  }

  const infoByUserId = new Map();
  for (const r of clientRoleRows || []) {
    if (!infoByUserId.has(r.user_id)) infoByUserId.set(r.user_id, { client_admin: false, stores: [] });
    infoByUserId.get(r.user_id).client_admin = true;
  }
  for (const r of storeRoleRows) {
    if (!infoByUserId.has(r.user_id)) infoByUserId.set(r.user_id, { client_admin: false, stores: [] });
    infoByUserId.get(r.user_id).stores.push({ store_id: r.store_id, store_name: storeNameById.get(r.store_id) ?? null, role: r.role });
  }

  const userIds = [...infoByUserId.keys()];
  if (userIds.length === 0) return [];

  const [{ data: users, error: usersErr }, { data: prefs, error: prefsErr }] = await Promise.all([
    supabaseAdmin.from('users').select('id, email, full_name').in('id', userIds),
    supabaseAdmin.from('user_preferences').select('user_id, default_shipping_address_id').in('user_id', userIds),
  ]);
  if (usersErr) throw new ApiError(500, 'Failed to list client users', usersErr.message);
  if (prefsErr) throw new ApiError(500, 'Failed to list client users', prefsErr.message);
  const defaultAddressByUserId = new Map((prefs || []).map((p) => [p.user_id, p.default_shipping_address_id]));

  return (users || [])
    .map((u) => ({
      ...u,
      client_admin: infoByUserId.get(u.id)?.client_admin ?? false,
      stores: infoByUserId.get(u.id)?.stores ?? [],
      default_shipping_address_id: defaultAddressByUserId.get(u.id) ?? null,
    }))
    .sort((a, b) => (a.email || '').localeCompare(b.email || ''));
}

// addressId null clears the override (falls back to store/pinned
// resolution at sync time -- see sync.js's resolveShippingAddress).
async function setUserDefaultShippingAddress(req, clientId, userId, addressId) {
  requireStaff(req);
  if (!userId || typeof userId !== 'string') throw new ApiError(400, 'userId is required');

  if (addressId) {
    // type='Shipping' only -- a login's default must never resolve to
    // the client's fixed Billing address (see orders.js's
    // validateShippingAddress for the same rule on the per-order path).
    const { data, error } = await supabaseAdmin
      .from('client_addresses')
      .select('id')
      .eq('id', addressId)
      .eq('client_id', clientId)
      .eq('type', 'Shipping')
      .maybeSingle();
    if (error || !data) throw new ApiError(400, "address_id isn't a valid shipping address for this client");
  }

  const { error } = await supabaseAdmin
    .from('user_preferences')
    .upsert({ user_id: userId, default_shipping_address_id: addressId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new ApiError(500, 'Failed to set default shipping address', error.message);
  return { user_id: userId, default_shipping_address_id: addressId };
}

module.exports = { syncAddresses, listManageableClients, updateShowPricing, listClientUsers, setUserDefaultShippingAddress };
