# Ordering Portal API

Backend skeleton (Phase 3) + Cin7 Core sync (Phase 4). Express +
`@supabase/supabase-js`.

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
| POST   | `/orders/:id/approve`  | `draft`/`pending_approval` -> `approved`, then syncs to Cin7 |
| POST   | `/orders/:id/reject`   | Body: `{ reason? }`. -> `rejected`               |

## Cin7 sync (Phase 4)

`src/services/cin7.js` (`syncOrderToCin7`) is called automatically after an
order moves to `approved`. It calls Cin7 Core's **V2** API in two steps —
`POST /Sale` (customer/header) then `POST /Sale/Order` (lines,
authorizes the order) — verified empirically against a real trial
account rather than guessed (see the sourced comments in that file), since
V2's line-item schema isn't published in Cin7's text docs. It uses:

- `clients.cin7_customer_id` as `CustomerID` — never searches/creates a
  customer.
- The store's pinned `stores.cin7_address_*` fields as `ShippingAddress`,
  sent exactly as stored — never modified or matched.
- `orders.cin7_reference` as `CustomerReference`.
- `orders.idempotency_key` as Cin7's `ExternalID` — a real, queryable
  dedup key (`GET /SaleList?ExternalID=...`), confirmed working via a
  live create-then-search test. If a sync is retried after the local DB
  lost track of a Sale that was already created (e.g. a timeout), this
  finds and completes/reuses it instead of creating a duplicate — closing
  the gap V1 would have had.
- Per-client tax config (`clients.cin7_tax_rule`, `clients.tax_rate` —
  added by `005_client_tax.sql`) to compute each line's `Tax`/`Total`,
  since different clients are taxed differently and `order_lines` has no
  tax data of its own. **`cin7_tax_rule` must exactly match a Tax Rule
  name configured in that client's own Cin7 account, or sync fails fast
  with a clear error rather than guessing.**

On success: `orders.status = 'synced_to_cin7'`, `cin7_sales_order_id` set
to Cin7's returned Sale `ID`, an `order_events` row logged. On failure:
`orders.status = 'sync_failed'`, `cin7_sync_error` set, `order_events`
logged — never left silently stuck on `approved`. Approval itself is not
undone by a sync failure (they're logged separately); nothing retries
automatically. If the Sale header is created but the order-lines call
fails partway through, the header stays in Cin7 (with its `ExternalID`
set) and the next sync attempt completes it rather than creating a
second header.

**Why V2 in the end:** originally shipped as V1 because V2's line schema
wasn't in the published docs. Once a trial account was available, the
real schema was confirmed by reading back Cin7's own validation errors
and a full live create → verify round trip (Sale header, order lines,
`ExternalID` search, tax computation) rather than assumed.

**Testing:** Cin7 Core has no sandbox mode. Use a free 14-day trial
account's own `CIN7_ACCOUNT_ID`/`CIN7_APPLICATION_KEY` for any testing —
never a production account.

## Running locally

```bash
cd backend
npm install
cp .env.example .env   # then fill in your Supabase project's values
npm start
```

Required env vars (see `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. `PORT` is optional (defaults to 3000; Render
sets this automatically in production). `CIN7_ACCOUNT_ID` /
`CIN7_APPLICATION_KEY` are optional locally — without them, sync attempts
fail cleanly (`sync_failed` + a clear error) instead of crashing.

## Deploying (Render)

This repo includes a `render.yaml` Blueprint at the repo root (`rootDir:
backend`). To deploy:

1. In the Render dashboard: **New -> Blueprint**, connect this GitHub repo.
2. Render reads `render.yaml` and creates the `ordering-portal-api` web
   service.
3. Set the secret env vars in the service's **Environment** tab
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`) — they're marked `sync: false`
   in the blueprint so Render prompts for them rather than expecting them
   in git.
4. Deploy. Render auto-redeploys on every push to `main` after that.

Render was picked over Railway mainly because the whole service definition
can live in git as `render.yaml` and be code-reviewed like anything else,
and its free web service tier is a good fit for a skeleton API like this.
