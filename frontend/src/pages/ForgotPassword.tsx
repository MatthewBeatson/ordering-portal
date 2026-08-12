import * as React from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

export default function ForgotPassword() {
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-semibold">Reset your password</h1>
        <p className="mb-6 text-sm text-[var(--muted-foreground)]">We'll email you a link to set a new one.</p>

        {sent ? (
          <p className="rounded-[var(--radius)] bg-[var(--success-muted)] px-3 py-2 text-sm text-[var(--success)]">
            Check your inbox for a reset link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">
                Email
              </label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

            <Button type="submit" variant="primary" disabled={loading} className="mt-1 w-full">
              {loading ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : 'Send reset link'}
            </Button>
          </form>
        )}

        <Link to="/login" className="mt-4 block text-center text-sm text-[var(--accent)] hover:underline">
          Back to sign in
        </Link>
      </Card>
    </div>
  );
}
