const { supabaseAdmin } = require('../config/supabase');

// Weekly TOTP re-verification for Shonrei staff (is_portal_admin / by
// extension is_super_admin, since super_admin implies portal_admin —
// see services/staff.js). Client accounts are never subject to this.
//
// Deliberately reuses Supabase Auth's own MFA state (auth.mfa_factors,
// via the Admin API's listFactors) rather than tracking a parallel
// "last verified" column ourselves -- last_challenged_at already IS
// exactly that, updated by Supabase itself on every successful
// mfa.verify() call, so there's nothing for us to keep in sync.
const REVERIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

async function checkStaffMfa(userId) {
  const { data, error } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
  if (error) {
    // Fail closed -- if we can't determine MFA state for a staff
    // account, don't silently let the request through.
    return { ok: false, code: 'MFA_CHECK_FAILED', message: 'Could not verify 2FA status' };
  }

  const verifiedTotp = (data?.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');

  if (!verifiedTotp) {
    return { ok: false, code: 'MFA_ENROLLMENT_REQUIRED', message: 'Two-factor authentication is required for Shonrei staff accounts' };
  }

  const lastChallenged = verifiedTotp.last_challenged_at ? new Date(verifiedTotp.last_challenged_at).getTime() : 0;
  if (Date.now() - lastChallenged > REVERIFY_INTERVAL_MS) {
    return { ok: false, code: 'MFA_REVERIFY_REQUIRED', message: 'Please re-verify your 2FA code (required weekly)' };
  }

  return { ok: true };
}

module.exports = { checkStaffMfa };
