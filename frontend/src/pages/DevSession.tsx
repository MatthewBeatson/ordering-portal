import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

// Dev-only local-testing aid: takes a session obtained out-of-band (e.g.
// via the Admin API for a test account whose email inbox doesn't exist)
// as plain query params and installs it via the supported setSession API
// -- avoids relying on detectSessionInUrl's hash-fragment parsing, which
// only recognizes the implicit flow's shape and silently no-ops under the
// PKCE flow this app otherwise uses. Never linked from the UI; only
// reachable if you know the URL, and the route itself doesn't exist in a
// production build (see App.tsx's import.meta.env.DEV guard).
export default function DevSession() {
  const [params] = useSearchParams();
  const [error, setError] = React.useState<string | null>(null);
  const navigate = useNavigate();

  React.useEffect(() => {
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) {
      setError('Missing access_token/refresh_token in the URL.');
      return;
    }
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) {
        setError(error.message);
        return;
      }
      navigate('/', { replace: true });
    });
  }, [params, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6 text-center">
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : <Spinner className="mx-auto h-6 w-6" />}
      </Card>
    </div>
  );
}
