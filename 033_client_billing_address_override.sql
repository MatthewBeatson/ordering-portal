-- 033_client_billing_address_override.sql
-- Explicit per-client override for which client_addresses row is pushed
-- as a Cin7 Sale's BillingAddress (resolveBillingAddress, sync.js).
--
-- Confirmed with the client (2026-09-11) that not every real Cin7
-- customer actually has an address typed "Billing": Signet/SG-UK's
-- three synced addresses are ALL typed "Shipping" in Cin7 itself (real
-- Watford + Birmingham shipping destinations, plus a stale placeholder
-- Watford row from the old trial account) -- there's no Cin7-side
-- "Billing" address to fall back on for this client at all, even
-- though the business always bills Signet's real Watford address.
-- JPL-AU and JPL-NZ both DO have a real Cin7-typed Billing address
-- (confirmed live) and need no override -- this column stays null for
-- them, and resolveBillingAddress keeps using the existing
-- type='Billing' AND is_default=true lookup as the fallback.
--
-- References client_addresses.id (the internal, STABLE id -- see
-- addressSync.js's upsert-not-replace comment) rather than a Cin7
-- address id, so this survives every future address re-sync
-- untouched, and is cleared automatically (not left dangling) if that
-- address is ever pruned because Cin7 no longer returns it.
alter table clients add column billing_client_address_id uuid references client_addresses(id) on delete set null;

comment on column clients.billing_client_address_id is
  'Explicit override: the client_addresses row to use as this client''s Cin7 Sale BillingAddress. Only needed when Cin7 has no address actually typed "Billing" for the customer (resolveBillingAddress falls back to type=Billing/is_default=true otherwise). Staff-set only, via direct DB/API -- no dedicated UI yet.';
