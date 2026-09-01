-- 024_client_product_attribute_overrides.sql
-- Extends client_product_attributes (022) with the same per-client
-- override mechanism for the three now-portal-native (023) taxonomy
-- attributes, alongside the existing jewellery_count. Confirmed with
-- the client (2026-09-01): global default + per-client override for
-- all four attributes -- product_type/colour overrides will rarely be
-- used (most clients just see the product's global value), jewellery
-- type/held is expected to commonly be overridden per client.
--
-- NULL in any column here still means "no override for this client --
-- use the product's global value," same convention 022 established.

alter table client_product_attributes add column product_type_id uuid references product_types(id);
alter table client_product_attributes add column jewellery_type_id uuid references product_jewellery_types(id);
alter table client_product_attributes add column colour_id uuid references product_colours(id);

comment on table client_product_attributes is
  'Per-(client, product) overrides for products'' now-portal-native classification (023) plus jewellery_count. NULL in any column means "no override -- use the product''s global value." Managed through the backend (service_role, staff-only) -- see backend/src/services/clientProductAttributes.js.';
