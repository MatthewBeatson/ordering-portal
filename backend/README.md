# Ordering Portal API

Backend skeleton (Phase 3). Express + `@supabase/supabase-js`.

## How authorization works

- Every request under `/orders` must carry `Authorization: Bearer <supabase JWT>`.
  The auth middleware (`src/middleware/auth.js`) verifies it via
  `supabase.auth.getUser(token)` and rejects with `401` if missing/invalid.
- All database reads/writes go through a `service_role` client
  (`src/config/supabase.js`), which bypasses RLS on purpose — this API is
  what enforces authorization for its own requests, not RLS.
- Per-record access checks (can this user touch this store's order?) call
  the *same* `has_store_access()` / `can_approve()` Postgres functions the
  RLS policies use, via RPC on a client scoped to the caller's own JWT. That
  keeps authorization logic in one place (SQL) instead of a second
  hand-maintained copy in JS.
- `GET /orders` filters by a set of accessible store ids resolved once in
  the middleware from `user_store_roles` / `user_client_roles` /
  `users.is_portal_admin` — the same underlying data, just read directly
  instead of one RPC call per row.

## Endpoints

| Method | Path                  | Notes                                          |
|--------|-----------------------|-------------------------------------------------|
| GET    | `/health`             | No auth required                                |
| POST   | `/orders`              | Body: `{ store_id, notes?, status?, lines: [{sku, description?, quantity, unit_price?}] }` |
| GET    | `/orders`              | Query: `?status=&limit=&offset=`                |
| GET    | `/orders/:id`          | Order + its lines                               |
| POST   | `/orders/:id/approve`  | `draft`/`pending_approval` -> `approved`         |
| POST   | `/orders/:id/reject`   | Body: `{ reason? }`. -> `rejected`               |

Cin7 sync is stubbed (`src/services/cin7.js`, `syncOrderToCin7`) — it just
logs, and is called after an order is approved. Real integration is a
separate later phase.

## Running locally

```bash
cd backend
npm install
cp .env.example .env   # then fill in your Supabase project's values
npm start
```

Required env vars (see `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. `PORT` is optional (defaults to 3000; Render
sets this automatically in production).

## Deploying (Render)

This repo includes a `render.yaml` Blueprint at the repo root (`rootDir:
backend`). To deploy:

1. In the Render dashboard: **New -> Blueprint**, connect this GitHub repo.
2. Render reads `render.yaml` and creates the `ordering-portal-api` web
   service.
3. Set the three secret env vars in the service's **Environment** tab
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) —
   they're marked `sync: false` in the blueprint so Render prompts for them
   rather than expecting them in git.
4. Deploy. Render auto-redeploys on every push to `main` after that.

Render was picked over Railway mainly because the whole service definition
can live in git as `render.yaml` and be code-reviewed like anything else,
and its free web service tier is a good fit for a skeleton API like this.
