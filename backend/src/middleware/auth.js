const { supabaseAdmin, supabaseAuth, createUserScopedClient } = require('../config/supabase');
const { ApiError } = require('../lib/errors');

// Verifies the Supabase JWT on every request, then resolves the caller's
// store/client roles so route handlers don't each have to re-query them.
//
// Two Supabase clients get attached to req:
//   - req.supabaseUser: scoped to this user's own access token. Route
//     handlers use it to call has_store_access(...)/can_approve(...) via
//     RPC, so those checks run through the exact same Postgres functions
//     RLS uses (auth.uid() resolves correctly because the request is
//     authenticated as this user).
// All actual data reads/writes still go through the service_role client
// (see config/supabase.js) — this middleware only handles who's asking
// and what they're allowed to touch.
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new ApiError(401, 'Missing or malformed Authorization header (expected "Bearer <token>")');
    }

    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) {
      throw new ApiError(401, 'Invalid or expired token');
    }

    const user = data.user;

    const [{ data: userRow, error: userErr }, { data: storeRoles, error: storeErr }, { data: clientRoles, error: clientErr }] =
      await Promise.all([
        supabaseAdmin.from('users').select('is_portal_admin, is_super_admin').eq('id', user.id).maybeSingle(),
        supabaseAdmin.from('user_store_roles').select('store_id, role').eq('user_id', user.id),
        supabaseAdmin.from('user_client_roles').select('client_id, role').eq('user_id', user.id),
      ]);

    if (userErr || storeErr || clientErr) {
      throw new ApiError(500, 'Failed to resolve user roles', {
        userErr: userErr?.message,
        storeErr: storeErr?.message,
        clientErr: clientErr?.message,
      });
    }

    const isPortalAdmin = userRow?.is_portal_admin === true;
    const isSuperAdmin = userRow?.is_super_admin === true;
    const clientIds = (clientRoles || []).map((r) => r.client_id);

    let accessibleStoreIds = new Set((storeRoles || []).map((r) => r.store_id));

    if (isPortalAdmin) {
      const { data: allStores, error: allStoresErr } = await supabaseAdmin.from('stores').select('id');
      if (allStoresErr) throw new ApiError(500, 'Failed to resolve accessible stores', allStoresErr.message);
      accessibleStoreIds = new Set((allStores || []).map((s) => s.id));
    } else if (clientIds.length > 0) {
      const { data: clientStores, error: clientStoresErr } = await supabaseAdmin
        .from('stores')
        .select('id')
        .in('client_id', clientIds);
      if (clientStoresErr) throw new ApiError(500, 'Failed to resolve accessible stores', clientStoresErr.message);
      for (const s of clientStores || []) accessibleStoreIds.add(s.id);
    }

    req.user = { id: user.id, email: user.email };
    req.roles = {
      isPortalAdmin,
      isSuperAdmin,
      storeRoles: storeRoles || [],
      clientRoles: clientRoles || [],
      accessibleStoreIds,
    };
    req.supabaseUser = createUserScopedClient(token);

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
