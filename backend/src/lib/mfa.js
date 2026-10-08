const { supabaseAdmin } = require('../config/supabase');

// TOTP re-verification for admin-level accounts: Shonrei staff
// (is_portal_admin / by extension is_super_admin, since super_admin implies
// portal_admin — see services/staff.js) re-verify weekly; client admins (any
// user_client_roles row) every two weeks. Buyers and store admins are never
// subject to this.
//
// Deliberately reuses Supabase Auth's own MFA state (auth.mfa_factors,
// via the Admin API's listFactors) rather than tracking a parallel
// "last verified" column ourselves -- last_challenged_at already IS
// exactly that, updated by Supabase itself on every successful
// mfa.verify() call, so there's nothing for us to keep in sync.
const DAY_MS = 24 * 60 * 60 * 1000;
const STAFF_REVERIFY_INTERVAL_MS = 7 * DAY_MS;
const CLIENT_ADMIN_REVERIFY_INTERVAL_MS = 14 * DAY_MS;

async function checkAdminMfa(userId, { isStaff }) {
  const reverifyIntervalMs = isStaff ? STAFF_REVERIFY_INTERVAL_MS : CLIENT_ADMIN_REVERIFY_INTERVAL_MS;
  const { data, error } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
  if (error) {
    // Fail closed -- if we can't determine MFA state for an admin
    // account, don't silently let the request through.
    return { ok: false, code: 'MFA_CHECK_FAILED', message: 'Could not verify 2FA status' };
  }

  const verifiedTotp = (data?.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');

  if (!verifiedTotp) {
    return { ok: false, code: 'MFA_ENROLLMENT_REQUIRED', message: 'Two-factor authentication is required for admin accounts' };
  }

  const lastChallenged = verifiedTotp.last_challenged_at ? new Date(verifiedTotp.last_challenged_at).getTime() : 0;
  if (Date.now() - lastChallenged > reverifyIntervalMs) {
    return { ok: false, code: 'MFA_REVERIFY_REQUIRED', message: 'Please re-verify your 2FA code' };
  }

  return { ok: true };
}

module.exports = { checkAdminMfa };
