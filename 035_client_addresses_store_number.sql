-- 035_client_addresses_store_number.sql
-- Lets a Cin7-synced address be tagged with the store number it
-- physically belongs to (e.g. "PR#443"), purely so it can be found by
-- searching that number in Cart's "Delivery address" box (2026-09-29
-- request) -- completely separate from stores.client_address_id (the
-- store's DEFAULT ship-to address, deliberately the two head offices
-- for most JPL-AU stores). Tagging an address here never changes any
-- store's default.
--
-- Cin7 has no store-number field on an address at all (confirmed live
-- -- an address is just Line1/Line2/City/State/Postcode/Country/Type/
-- ID), so this can only ever be maintained portal-side, via the
-- store<->address matcher (services/stores.js) or a manual fix.
-- Nullable and free text on purpose -- an address with no confident
-- match just stays untagged, still searchable by its own text as
-- before.
--
-- Safe across re-syncs: addressSync.js's upsert payload never includes
-- this column, so a future Cin7 address sync can't touch it.
alter table client_addresses add column store_number text;

create index idx_client_addresses_store_number on client_addresses(client_id, store_number) where store_number is not null;
