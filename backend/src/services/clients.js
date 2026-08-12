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

module.exports = { syncAddresses };
