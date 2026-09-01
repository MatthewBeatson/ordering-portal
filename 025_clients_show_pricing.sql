-- 025_clients_show_pricing.sql
-- New per-client pricing-visibility switch, settable only by Shonrei
-- super admins (backend/src/services/clients.js requireSuperAdmin) --
-- confirmed with the client (2026-09-01) this is per-client, not a
-- single portal-wide switch.
--
-- Defaults true deliberately: pricing already shows today for every
-- client with a cin7_price_tier set (incidentally, via the hasPricing
-- checks in Cart.tsx/OrderDetail.tsx). Defaulting false would silently
-- hide pricing from every existing client until a super admin visits
-- the new Client Settings screen -- a regression on ship day. A super
-- admin can flip specific clients off immediately after this ships.
alter table clients add column show_pricing boolean not null default true;

comment on column clients.show_pricing is
  'Whether this client sees prices/totals in Catalog, Cart, and Order Detail. Settable only by Shonrei super admins.';
