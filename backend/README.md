# Ordering Portal API

Backend for the Shonrei multi-store B2B ordering portal. Express +
`@supabase/supabase-js`. Phase 3 (skeleton) + Phase 4 (Cin7 sync) + Phase 5
(provider-agnostic order lifecycle + review hold/shipped/cancellation).

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
- `/webhooks/cin7` is the one exception — Cin7 isn't a Supabase user, so
  it's authenticated with a shared bearer token instead (see below), not
  `requireAuth`.

## Order lifecycle (Phase 5)

`pending -> confirmed -> in_progress -> shipped -> delivered`, with
`rejected` as a pre-confirm terminal state (the client-admin declined it).

- **confirmed**: a client-admin/store-admin approved the order.
- **in_progress**: entered *automatically* the moment a confirmed order
  successfully syncs to Cin7 as a Sale — no manual "start" step, and this
  applies to in-stock and made-to-order/backordered items alike (a
  backorder is not an error, see `integrations/cin7/sync.js`).
- **Review hold**: Shonrei staff can flag an order (`POST /orders/:id/flag`)
  before it syncs; while `flagged_for_review` is true the order stays at
  `confirmed` and the sync attempt is skipped entirely. Clearing the flag
  (`POST /orders/:id/clear-flag`) triggers the deferred sync. This hold is
  **internal-only** — non-staff API responses never include
  `flagged_for_review`/`flagged_reason`/`flagged_by`/`reviewed_*` at all
  (see `sanitizeOrder` in `services/orders.js`); they just see `confirmed`.
- **shipped**: primarily a manual bulk action
  (`POST /orders/bulk/ship { order_ids: [...] }`, staff-only, only from
  `in_progress`) — `shipped_source: 'manual'`. Falls back to automatic via
  Cin7's `Sale/InvoiceAuthorised` webhook event (`shipped_source:
  'auto_invoice'`), but never overwrites a manual mark (Shonrei uses an
  invoice-first flow — goods are often packed/shipped/invoiced before
  Cin7's own stock/BOM step catches up, so Cin7 events here are treated as
  confirmation, not real-time truth).
- **Cancellation**: pre-sync (`pending`/`confirmed`-not-yet-synced), a
  plain `DELETE /orders/:id` still works. Once an order has reached
  `in_progress` it can no longer be deleted — use
  `POST /orders/:id/request-cancellation` /
  `POST /orders/:id/resolve-cancellation` (staff) instead. Resolving a
  cancellation only updates our own records for now; it does not (yet)
  void the Sale in Cin7 — that's a follow-up.

## Endpoints

| Method | Path                              | Notes                                          |
|--------|-----------------------------------|-------------------------------------------------|
| GET    | `/health`                         | No auth required                                |
| POST   | `/orders`                         | Body: `{ store_id, notes?, lines: [{sku, description?, quantity, unit_price?}] }` — always created as `pending` |
| GET    | `/orders`                         | Query: `?status=&limit=&offset=`                |
| GET    | `/orders/:id`                     | Order + its lines                               |
| DELETE | `/orders/:id`                     | Pre-sync only (`pending`/`confirmed`-unsynced)  |
| POST   | `/orders/:id/confirm`             | `pending` -> `confirmed`, then attempts Cin7 sync unless flagged |
| POST   | `/orders/:id/reject`              | Body: `{ reason? }`. `pending` -> `rejected`    |
| POST   | `/orders/:id/flag`                | Staff only. Body: `{ reason? }`                 |
| POST   | `/orders/:id/clear-flag`          | Staff only. Triggers deferred sync if `confirmed` |
| POST   | `/orders/bulk/ship`               | Staff only. Body: `{ order_ids: [...] }`        |
| POST   | `/orders/:id/request-cancellation`| Body: `{ reason? }`. Post-sync only             |
| POST   | `/orders/:id/resolve-cancellation`| Staff only. Body: `{ approve: boolean }`        |
| POST   | `/webhooks/cin7`                  | Cin7 callback receiver — bearer token, not a Supabase JWT |

## Cin7 integration (`src/integrations/cin7/`)

The **only** part of the app that ever talks to Cin7 or holds its
credentials. Nothing else should import Cin7 internals directly.

- `client.js` — raw HTTP calls (`POST /Sale`, `POST /Sale/Order`,
  `GET /SaleList?ExternalID=`, `GET /Sale?ID=`). Cin7 **V2**, chosen over
  V1 because V2's `ExternalID` field gives a real, queryable idempotency
  mechanism (`orders.idempotency_key` -> `ExternalID`) — confirmed via a
  live create-then-search round trip against a trial account, since V2's
  line-item schema isn't in Cin7's published text docs (only a
  sign-in-gated API Explorer) and had to be verified by reading back
  Cin7's own validation errors rather than guessed.
- `lines.js` — merges duplicate SKUs before submitting (Cin7 rejects a
  Sale with the same SKU twice in `Lines`), and computes each line's
  `Tax`/`Total` from the order's client's `tax_rate`/`cin7_tax_rule`
  (`clients` columns from `005_client_tax.sql`) since `order_lines` has
  no tax data of its own and different clients are taxed differently.
- `sync.js` — orchestrates a sync: validates the order is ready (customer
  id, tax rule, pinned address, has lines), skips entirely if
  `flagged_for_review`, writes the outcome to `inventory_sync`
  (**not** `orders.cin7_*` columns — that's the provider-agnostic split;
  a failed sync leaves the order at `confirmed`, it does not get its own
  Cin7-flavoured `order_status`), and flips `orders.status` to
  `in_progress` on success. Captures `BackorderQuantity` (present in
  Cin7's own line response) into `inventory_sync.raw_payload` for
  visibility — never treated as a failure.
- `statusMapping.js` — translates a Cin7 event into a provider-agnostic
  action (currently: `Sale/InvoiceAuthorised` -> shipped-status fallback).
  Shared by `webhook.js` and any future polling job, so there's one
  translation implementation, not two that could drift.
- `webhook.js` — receives Cin7's webhook POSTs at `/webhooks/cin7`. **Cin7
  does not sign webhook payloads** — instead, when a webhook is
  registered you choose an `ExternalAuthorizationType` (`bearerauth` used
  here) and Cin7 attaches that exact credential to every callback, so
  verification here is just comparing the `Authorization` header against
  `CIN7_WEBHOOK_TOKEN`. Confirmed via Cin7's own Webhooks reference docs,
  not guessed. Unhandled event types are accepted (200, so Cin7 doesn't
  retry) and ignored.
- `scripts/register-cin7-webhook.js` — one-time setup script that
  registers the `Sale/InvoiceAuthorised` webhook against a Cin7 account,
  pointing at a given callback URL. **Requires the Automations module on
  that Cin7 plan** — confirmed present on the trial account used for
  testing; unconfirmed for Shonrei's production Cin7 account. If it's not
  included, registration fails and the fallback is polling
  `SaleList?UpdatedSince=` (not yet built).

`inventory_sync` (from `006_provider_agnostic_orders.sql`) is the
provider-agnostic mapping table: `{order_id, provider, external_id,
status, error_message, raw_payload}`. Swapping inventory providers later
means a new adapter under `integrations/`, not a schema rebuild.

**Testing:** Cin7 Core has no sandbox mode. Use a free 14-day trial
account's own `CIN7_ACCOUNT_ID`/`CIN7_APPLICATION_KEY` (and register the
webhook against that same account) for any testing — never a production
account.

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
`CIN7_APPLICATION_KEY` / `CIN7_WEBHOOK_TOKEN` are optional locally —
without them, sync attempts fail cleanly (`inventory_sync` row with
`status: 'failed'` + a clear error) instead of crashing, and the webhook
receiver just rejects everything with 401.

## Deploying (Render)

This repo includes a `render.yaml` Blueprint at the repo root (`rootDir:
backend`). To deploy:

1. In the Render dashboard: **New -> Blueprint**, connect this GitHub repo.
2. Render reads `render.yaml` and creates the `ordering-portal-api` web
   service.
3. Set the secret env vars in the service's **Environment** tab
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `CIN7_ACCOUNT_ID`, `CIN7_APPLICATION_KEY`, `CIN7_WEBHOOK_TOKEN`) —
   they're marked `sync: false` in the blueprint so Render prompts for
   them rather than expecting them in git.
4. Deploy. Render auto-redeploys on every push to `main` after that.
5. Once deployed, run `node scripts/register-cin7-webhook.js
   https://<your-service>.onrender.com/webhooks/cin7` (with the same env
   vars set) to register the webhook against that Cin7 account.

Render was picked over Railway mainly because the whole service definition
can live in git as `render.yaml` and be code-reviewed like anything else,
and its free web service tier is a good fit for an API like this.
