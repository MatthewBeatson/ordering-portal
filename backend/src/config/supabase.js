const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [name, value] of Object.entries({
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
})) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
}

// service_role client: bypasses RLS. Used for all actual data reads/writes —
// the backend is the thing enforcing authorization (see middleware/auth.js
// and services/orders.js), not RLS, for requests that come through this API.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// anon-key client with no user session attached. Used only to verify
// incoming JWTs via auth.getUser(token) — this asks Supabase Auth to
// validate the token rather than us re-implementing JWT verification.
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Per-request client scoped to one user's access token. RLS-checking
// Postgres functions (has_store_access, can_approve) key off auth.uid(),
// which Postgres only sees correctly when the request is authenticated
// as that user — calling them through supabaseAdmin would evaluate
// auth.uid() as null. This client lets endpoint code call those exact
// same functions the RLS policies use, via RPC, instead of re-implementing
// the access rules in JS (which could drift out of sync).
function createUserScopedClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

module.exports = { supabaseAdmin, supabaseAuth, createUserScopedClient };
