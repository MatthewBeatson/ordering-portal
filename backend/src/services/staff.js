const { supabaseAdmin } = require('../config/supabase');
const { ApiError } = require('../lib/errors');

// Super-admin-only: managing who else is Shonrei staff (is_portal_admin)
// and who among staff is themselves a super admin (is_super_admin).
// Regular is_portal_admin keeps every capability it already had --
// this is strictly additive, gating only this screen.

function requireSuperAdmin(req) {
  if (!req.roles.isSuperAdmin) {
    throw new ApiError(403, 'This action is restricted to Shonrei super admins');
  }
}

// Lists everyone who already has a `users` row -- i.e. everyone who's
// ever been given some portal access (buyer, store_admin, client_admin,
// or staff). There's no "search all Supabase Auth accounts" here on
// purpose: an earlier incident in this project (see project memory)
// showed the Admin API's email filter can silently return the wrong
// account, and this screen can grant staff-level access -- too
// dangerous a surface to build on that API. Onboarding someone with
// zero portal access yet still requires the existing manual step
// (inserting their `users` row directly), same as it always has for
// every other role in this project.
async function listStaff(req) {
  requireSuperAdmin(req);

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, is_portal_admin, is_super_admin, created_at')
    .order('is_super_admin', { ascending: false })
    .order('is_portal_admin', { ascending: false })
    .order('email');
  if (error) throw new ApiError(500, 'Failed to list staff', error.message);
  return data;
}

async function updateStaffFlags(req, targetUserId, input) {
  requireSuperAdmin(req);

  if (!targetUserId || typeof targetUserId !== 'string') throw new ApiError(400, 'A target user id is required');

  const { data: target, error: targetErr } = await supabaseAdmin
    .from('users')
    .select('id, is_portal_admin, is_super_admin')
    .eq('id', targetUserId)
    .maybeSingle();
  if (targetErr) throw new ApiError(500, 'Failed to load user', targetErr.message);
  if (!target) throw new ApiError(404, 'User not found');

  let isPortalAdmin = typeof input?.is_portal_admin === 'boolean' ? input.is_portal_admin : target.is_portal_admin;
  let isSuperAdmin = typeof input?.is_super_admin === 'boolean' ? input.is_super_admin : target.is_super_admin;

  // A super admin is always a portal admin too -- and demoting someone
  // off is_portal_admin has to take is_super_admin with it, since
  // "super admin but not admin" isn't a coherent state.
  if (isSuperAdmin) isPortalAdmin = true;
  if (!isPortalAdmin) isSuperAdmin = false;

  // Never let a super admin strip their own is_super_admin/
  // is_portal_admin -- that's a self-lockout with no recovery path
  // short of a direct DB edit. Another super admin can still do it.
  const isSelf = targetUserId === req.user.id;
  if (isSelf && (target.is_super_admin || target.is_portal_admin) && (!isSuperAdmin || !isPortalAdmin)) {
    throw new ApiError(409, 'You cannot remove your own admin/super-admin status -- ask another super admin to do it');
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ is_portal_admin: isPortalAdmin, is_super_admin: isSuperAdmin })
    .eq('id', targetUserId)
    .select('id, email, full_name, is_portal_admin, is_super_admin, created_at')
    .single();
  if (error) throw new ApiError(500, 'Failed to update staff flags', error.message);
  return data;
}

module.exports = { listStaff, updateStaffFlags };
