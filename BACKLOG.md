# Ordering Portal — backlog

Deferred/queued items from ongoing design discussion, not yet built.
Not in priority order — see conversation history for context on each.

## Currency display
`frontend/src/lib/format.ts`'s `money()` hardcodes a `$` symbol
everywhere prices render (Catalog, Cart, Order Detail, Approvals).
Needs to reflect the actual client's currency instead — e.g. `£` for
SG - UK (GBP) and any future non-NZD client. Cin7 customers already
carry a real `Currency` field (confirmed via the live API); need to
decide whether to mirror that onto `clients` or derive it another way,
then thread it through to every price display.

## Order reference presets + address pull-through
- Store search box (type-to-filter, not a plain dropdown) for picking
  which store/order to build a cart against — matters once a client
  has many stores.
- Auto-generate `orders.reference` at **confirm time** (not creation
  time) as `{store_number} ({confirm date DD.MM.YY})` — store_number
  should hold the client's own full preformatted code (e.g. `PR#346`),
  not just a bare number. Already flows through to Cin7 as
  `CustomerReference` once set (see `backend/src/integrations/cin7/
  client.js`).
- Mirror a client's Cin7 addresses (`Addresses` collection — confirmed
  real, supports multiple addresses with `Type`/`DefaultForType`) into
  a new Supabase table, default to Cin7's `DefaultForType` shipping
  address, let the buyer pick an alternate if one exists. Replaces
  today's one-address-per-store manual pin
  (`stores.cin7_address_*`, set once by a human, never synced).

Now that 3 realistic clients exist ([[large_client_test_setup]] /
`013_per_client_portal_products.sql` era), this is unblocked — user
said "help me through this process sometime once 3x clients set up."

## Bulk pending-order grid/grouped view
Bulk select + confirm already shipped on the Approvals list (checkbox
+ "Confirm N selected", `POST /orders/bulk/confirm`). Still open: a
genuinely different view — SKUs/QTYs aggregated across *multiple*
pending orders in one grid, so an approver reviews volume rather than
order-by-order. Needs a proper design pass first (how ties/duplicate
SKUs across orders get shown, whether quantities sum or stay
per-order) — same kind of mockup exercise as the Catalog grouping was.

## Product image upload + resize
No staff-facing upload screen exists yet — images have to be inserted
into the `product-images` Storage bucket directly. When built, auto-
resize/compress on upload so a large source photo doesn't get stored
at full resolution when it only ever displays at ~80px (Catalog
thumbnail) — decouples "looks good on screen" from "small file size."
