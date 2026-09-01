-- 023_portal_native_taxonomy.sql
-- Confirmed with the client (2026-09-01): product_type, jewellery_type,
-- and colour stop being synced from Cin7 Additional Attributes 1-3
-- (see productSync.js) and become staff-managed directly in the portal
-- instead, via a new admin "taxonomy" screen. display_system stays
-- Cin7 Category-sourced -- unaffected by this migration.
--
-- Existing Cin7-synced classification is wiped (explicit client
-- decision -- staff rebuild it from scratch rather than inherit
-- possibly-messy Cin7 data). Only the FK columns on `products` are
-- cleared -- the reference table rows themselves are left in place for
-- staff to rename/reorder/delete via the new admin screen, not
-- truncated by this migration.
update products set product_type_id = null, jewellery_type_id = null, colour_id = null;

-- The Cin7 sync anchor columns are meaningless once productSync.js
-- stops writing AdditionalAttribute1-3 -- drop them rather than leave
-- dead nullable unique columns for a future dev to wonder about.
alter table product_types drop column cin7_attribute_value;
alter table product_jewellery_types drop column cin7_attribute_value;
alter table product_colours drop column cin7_attribute_value;

-- Now portal-native (staff-typed, not Cin7-anchored) -- add the same
-- name-uniqueness guarantee product_types already had, so the new
-- admin CRUD can't create accidental duplicates. (Checked live data
-- first -- no pre-existing duplicate names in either table.)
alter table product_colours add constraint product_colours_name_key unique (name);
alter table product_jewellery_types add constraint product_jewellery_types_name_key unique (name);
