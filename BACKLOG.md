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
- ~~Mirror a client's Cin7 addresses~~ — **done** (`014_client_addresses.sql`
  + `POST /clients/:id/sync-addresses`): Cart shows the client's default
  address, read-only. Still open: letting a buyer pick a *non-default*
  address per order and feeding that choice into the Cin7 Sale at sync
  time (today's sync always uses the store's original pinned address,
  not the mirrored ones).
- Store search box (type-to-filter, not a plain dropdown) for picking
  which store/order to build a cart against — matters once a client
  has many stores. Not built; Catalog/Cart still use a plain `<select>`.
- Auto-generate `orders.reference` at **confirm time** (not creation
  time) as `{store_number} ({confirm date DD.MM.YY})` — store_number
  can now hold the client's own full preformatted code (e.g. `PR#346`)
  since the Account page (`/account`) lets client-admins/staff set it
  directly. The auto-generation itself isn't built yet — `reference`
  still has to be set by hand. Already flows through to Cin7 as
  `CustomerReference` once set (see `backend/src/integrations/cin7/
  client.js`).

## Bulk pending-order grid/grouped view
Bulk select + confirm already shipped on the Approvals list (checkbox
+ "Confirm N selected", `POST /orders/bulk/confirm`). Still open: a
genuinely different view — SKUs/QTYs aggregated across *multiple*
pending orders in one grid, so an approver reviews volume rather than
order-by-order. Needs a proper design pass first (how ties/duplicate
SKUs across orders get shown, whether quantities sum or stay
per-order) — same kind of mockup exercise as the Catalog grouping was.

## Jewellery-count breakdown table (Catalog + Cart)
Once Attributes 1-3 (Type/Jewellery held/Colour, `018_product_jewellery_types.sql`
era) are actually populated in Cin7 and synced -- **Attribute 5** (Numeric
type, up to 4 decimal places, confirmed supported by Cin7) becomes each
product's jewellery-item capacity, e.g. "this tray displays 12 rings."
Deliberately NOT parsed from the free-text description -- too
unreliable, a real numeric field is the correct source.

`products.jewellery_capacity` (nullable numeric) synced the same way
as the other Attribute-sourced fields, paired with the product's own
`jewellery_type_id` (Attribute 2) to know *what* it's a count of.

A small toggle-able table (Show/Hide, same interaction as
`ImageSizeToggle`) on both Cart and Catalog: sums `quantity ×
jewellery_capacity` grouped by jewellery type (Rings / Earrings /
Pendants / ...). Cart's version is unambiguous -- it's exactly what's
in the cart. Catalog's meaning needs a design decision when this is
picked up: total across the *currently filtered/visible* products, or
something else -- worth a quick confirm before building rather than
guessing.

Also wanted on Approvals: a 1-click view per pending order (not just
Cart/Catalog) so an admin can quickly see the jewellery-count
breakdown for that specific order without opening its full detail
page -- same underlying `quantity × jewellery_capacity` calc, just
scoped to one order's lines instead of the whole cart.

## Move DNS to Shonrei's own Cloudflare account
3rd party confirmed (2026-08-28): the Cloudflare account managing
`shonrei.co.nz`/`shonrei.com` DNS is theirs, not Shonrei's -- moving it
means creating a new Cloudflare account under Shonrei, migrating the
DNS zone across, then repointing the domains' nameservers at the
registrar. Good news: domain *registration* itself is already
Shonrei's, confirmed by the same reply -- no transfer needed there.
Still open: whether Shonrei has direct login access to the actual
registrar (DiscountDomains) to make the nameserver change themselves,
or whether that step also needs the 3rd party. Deliberately deferred --
user asked to hold off until the daily-report auth migration + Resend
setup are finished, then revisit.

## Product image upload + resize
No staff-facing upload screen exists yet — images have to be inserted
into the `product-images` Storage bucket directly. When built, auto-
resize/compress on upload so a large source photo doesn't get stored
at full resolution when it only ever displays at ~80px (Catalog
thumbnail) — decouples "looks good on screen" from "small file size."
