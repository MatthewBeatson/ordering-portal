import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

// Reached via the link in the reset-password email. Supabase's client
// establishes a temporary recovery session from the URL automatically
// (detectSessionInUrl: true in lib/supabase.ts) -- but that session is
// only AAL1, and Supabase refuses to change a password/email at AAL1
// once the account has a verified MFA factor ("AAL2 session is
// required..."). Staff accounts always have MFA enrolled (see the
// weekly-2FA requirement), so this hits every staff password reset --
// checked for and challenged here before ever showing the password
// form, rather than letting updateUser fail after the fact.
export default function ResetPassword() {
  const [checkingMfa, setCheckingMfa] = React.useState(true);
  const [mfaFactorId, setMfaFactorId] = React.useState<string | null>(null);
  const [mfaCode, setMfaCode] = React.useState('');
  const [mfaError, setMfaError] = React.useState<string | null>(null);
  const [mfaVerifying, setMfaVerifying] = React.useState(false);
  const [mfaCleared, setMfaCleared] = React.useState(false);

  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const navigate = useNavigate();

  React.useEffect(() => {
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(async ({ data, error: err }) => {
      if (err || !data || data.nextLevel !== 'aal2' || data.currentLevel === 'aal2') {
        // No MFA factor on this account, or already at aal2 -- nothing to challenge.
        setCheckingMfa(false);
        return;
      }
      const { data: factorData } = await supabase.auth.mfa.listFactors();
      const factor = factorData?.totp?.[0];
      setCheckingMfa(false);
      if (!factor) {
        setMfaError('Your 2FA setup could not be verified. Please contact a super admin to reset it.');
        return;
      }
      setMfaFactorId(factor.id);
    });
  }, []);

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaFactorId) return;
    setMfaError(null);
    setMfaVerifying(true);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code: mfaCode });
    setMfaVerifying(false);
    if (err) {
      setMfaError(err.message);
      return;
    }
    setMfaCleared(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => navigate('/', { replace: true }), 1500);
  }

  const needsMfaChallenge = mfaFactorId !== null && !mfaCleared;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        {checkingMfa ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6" />
          </div>
        ) : needsMfaChallenge ? (
          <>
            <h1 className="mb-1 text-lg font-semibold">Re-verify your 2FA code</h1>
            <p className="mb-4 text-sm text-[var(--muted-foreground)]">
              This account has two-factor authentication enabled. Enter the current code from your authenticator app
              before setting a new password.
            </p>
            <form onSubmit={handleMfaVerify} className="flex flex-col gap-3">
              <Input
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="6-digit code"
                inputMode="numeric"
                autoFocus
                maxLength={6}
              />
              {mfaError && <p className="text-sm text-[var(--danger)]">{mfaError}</p>}
              <Button type="submit" variant="primary" disabled={mfaVerifying || mfaCode.length !== 6}>
                {mfaVerifying ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : 'Verify'}
              </Button>
            </form>
          </>
        ) : mfaError ? (
          <p className="text-sm text-[var(--danger)]">{mfaError}</p>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-semibold">Set a new password</h1>

            {done ? (
              <p className="mt-4 rounded-[var(--radius)] bg-[var(--success-muted)] px-3 py-2 text-sm text-[var(--success)]">
                Password updated. Redirecting...
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
                <div>
                  <label htmlFor="password" className="mb-1 block text-sm font-medium">
                    New password
                  </label>
                  <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="confirm" className="mb-1 block text-sm font-medium">
                    Confirm password
                  </label>
                  <Input id="confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>

                {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

                <Button type="submit" variant="primary" disabled={loading} className="mt-1 w-full">
                  {loading ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : 'Update password'}
                </Button>
              </form>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
