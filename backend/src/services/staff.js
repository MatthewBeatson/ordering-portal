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

  // Attach 2FA status for staff rows only -- client/buyer rows never
  // go through the weekly-MFA check, so their status is irrelevant
  // noise on this screen.
  const withMfaStatus = await Promise.all(
    (data || []).map(async (row) => {
      if (!row.is_portal_admin) return { ...row, mfa_enrolled: null };
      const { data: factorData } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: row.id });
      const verified = (factorData?.factors || []).some((f) => f.factor_type === 'totp' && f.status === 'verified');
      return { ...row, mfa_enrolled: verified };
    })
  );
  return withMfaStatus;
}

// Recovery path for a lost authenticator device -- removes every MFA
// factor on the target account, dropping them back to
// "enrollment required" on their next request rather than a permanent
// lockout. Deliberately super-admin-only, same as every other staff
// mutation here.
async function resetMfa(req, targetUserId) {
  requireSuperAdmin(req);
  if (!targetUserId || typeof targetUserId !== 'string') throw new ApiError(400, 'A target user id is required');

  const { data: factorData, error: listErr } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: targetUserId });
  if (listErr) throw new ApiError(500, 'Failed to list factors', listErr.message);

  for (const factor of factorData?.factors || []) {
    const { error: delErr } = await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: targetUserId, id: factor.id });
    if (delErr) throw new ApiError(500, `Failed to remove factor ${factor.id}`, delErr.message);
  }

  return { ok: true, factorsRemoved: factorData?.factors?.length || 0 };
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

  // Staff and client-side roles (store/client) are mutually exclusive,
  // by absolute guarantee -- this check just gives a clean error
  // instead of the raw Postgres exception; the real enforcement is
  // 020_staff_client_mutual_exclusion.sql's triggers, which hold
  // regardless of what this function does.
  if (isPortalAdmin && !target.is_portal_admin) {
    const [{ count: storeRoleCount }, { count: clientRoleCount }] = await Promise.all([
      supabaseAdmin.from('user_store_roles').select('id', { count: 'exact', head: true }).eq('user_id', targetUserId),
      supabaseAdmin.from('user_client_roles').select('id', { count: 'exact', head: true }).eq('user_id', targetUserId),
    ]);
    if ((storeRoleCount ?? 0) > 0 || (clientRoleCount ?? 0) > 0) {
      throw new ApiError(409, 'This user already holds a client-side role (store or client) -- staff access can never be granted to a client account');
    }
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

module.exports = { listStaff, updateStaffFlags, resetMfa };
