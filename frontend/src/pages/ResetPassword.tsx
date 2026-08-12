import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

// Reached via the link in the reset-password email. Supabase's client
// establishes a temporary recovery session from the URL automatically
// (detectSessionInUrl: true in lib/supabase.ts); this just collects the
// new password and calls updateUser.
export default function ResetPassword() {
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const navigate = useNavigate();

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

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
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
      </Card>
    </div>
  );
}
