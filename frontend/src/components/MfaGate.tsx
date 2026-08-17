import * as React from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

// Blocking gate for Shonrei staff (is_portal_admin) between login and
// the app shell -- enforces the weekly TOTP requirement. Never applies
// to buyer/store_admin/client_admin accounts (mfaRequired stays null
// for them, see AuthContext.resolveRoles). Sits inside ProtectedRoute
// but outside AppShell in App.tsx, so it only ever runs for an already
// -authenticated session.
export function MfaGate() {
  const { mfaRequired, loading, session, signOut } = useAuth();

  if (loading || !session) return <Outlet />; // ProtectedRoute already handles these states
  if (!mfaRequired) return <Outlet />;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        {mfaRequired === 'MFA_ENROLLMENT_REQUIRED' ? <MfaEnroll /> : <MfaChallenge />}
        <button onClick={() => signOut()} className="mt-4 block w-full text-center text-xs text-[var(--muted-foreground)] hover:underline">
          Sign in as someone else
        </button>
      </Card>
    </div>
  );
}

function MfaEnroll() {
  const { refreshMfaStatus } = useAuth();
  const [factorId, setFactorId] = React.useState<string | null>(null);
  const [qrCode, setQrCode] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const enrollStarted = React.useRef(false);

  React.useEffect(() => {
    if (enrollStarted.current) return;
    enrollStarted.current = true;
    supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Ordering portal' }).then(({ data, error: err }) => {
      if (err) {
        setError(err.message);
        return;
      }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
    });
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    await refreshMfaStatus();
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Set up two-factor authentication</h1>
      <p className="mb-4 text-sm text-[var(--muted-foreground)]">
        Required for Shonrei staff accounts. Scan this with an authenticator app (Google Authenticator, Authy, 1Password, etc.).
      </p>

      {qrCode ? (
        <>
          <img src={qrCode} alt="Scan with your authenticator app" className="mx-auto mb-3 h-40 w-40" />
          {secret && (
            <p className="mb-4 break-all text-center text-xs text-[var(--muted-foreground)]">
              Can't scan? Enter manually: <span className="font-mono">{secret}</span>
            </p>
          )}
          <form onSubmit={handleVerify} className="flex flex-col gap-3">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              inputMode="numeric"
              autoFocus
              maxLength={6}
            />
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <Button type="submit" variant="primary" disabled={loading || code.length !== 6}>
              {loading ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : 'Verify & finish setup'}
            </Button>
          </form>
        </>
      ) : error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : (
        <div className="flex justify-center py-6">
          <Spinner className="h-6 w-6" />
        </div>
      )}
    </>
  );
}

function MfaChallenge() {
  const { refreshMfaStatus } = useAuth();
  const [factorId, setFactorId] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data, error: err }) => {
      setLoading(false);
      if (err) {
        setError(err.message);
        return;
      }
      const factor = data?.totp?.[0];
      if (!factor) {
        // No verified factor found client-side even though the backend
        // said re-verify -- fall back to treating this as enrollment.
        setError('Your 2FA setup could not be found. Please contact a super admin to reset it.');
        return;
      }
      setFactorId(factor.id);
    });
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    await refreshMfaStatus();
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Re-verify your 2FA code</h1>
      <p className="mb-4 text-sm text-[var(--muted-foreground)]">
        Shonrei staff accounts re-confirm 2FA weekly. Enter the current code from your authenticator app.
      </p>

      {loading && !factorId ? (
        <div className="flex justify-center py-6">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6-digit code"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            disabled={!factorId}
          />
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          <Button type="submit" variant="primary" disabled={loading || !factorId || code.length !== 6}>
            {loading ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : 'Verify'}
          </Button>
        </form>
      )}
    </>
  );
}
