// Lets the plain-fetch api.ts layer notify AuthContext (a React
// context) when the backend rejects a request with a weekly-MFA error
// code -- api.ts has no access to React context, so this is a tiny
// module-level pub/sub bridge instead. This is a *reactive* backstop:
// AuthContext also proactively checks MFA status on login, but that
// check can't always see staleness (Supabase's self-listFactors()
// doesn't reliably include last_challenged_at) -- this catches it the
// moment any real API call hits the backend's authoritative check.
export type MfaRequiredCode = 'MFA_ENROLLMENT_REQUIRED' | 'MFA_REVERIFY_REQUIRED' | 'MFA_CHECK_FAILED';

let handler: ((code: MfaRequiredCode) => void) | null = null;

export function setMfaRequiredHandler(fn: ((code: MfaRequiredCode) => void) | null) {
  handler = fn;
}

export function triggerMfaRequired(code: MfaRequiredCode) {
  handler?.(code);
}
