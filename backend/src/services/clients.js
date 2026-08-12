const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');
const { syncClientAddresses } = require('../integrations/cin7/addressSync');

function requireStaff(req) {
  if (!req.roles.isPortalAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei staff');
  }
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

module.exports = { syncAddresses, listManageableClients };
