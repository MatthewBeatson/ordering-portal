-- Per-user default shipping address (confirmed with the client: this is
-- a PER-LOGIN default, e.g. a QLD-based admin's login always defaults
-- to Capalaba regardless of which store number they're ordering under
-- -- NOT a per-store thing, since in practice a single Prouds head-
-- office address covers the vast majority of that store's own orders
-- too. Same table/RLS as image_size/group_mode -- self-service read
-- (a buyer can see their own resolved default), but the actual write
-- path for THIS field is staff-only (see clientUsers service), not
-- self-service, since it's staff who assign which login defaults
-- where -- the existing self-service RLS still applies at the row
-- level, staff writes go through service_role same as everywhere else.
alter table user_preferences
  add column default_shipping_address_id uuid references client_addresses(id) on delete set null;

-- Per-order shipping address override -- lets a buyer pick a different
-- address than their resolved default for one specific order, without
-- changing their standing default. Resolution priority at sync time
-- (see sync.js's resolveShippingAddress): this order-level pick, then
-- the ordering user's own default_shipping_address_id, then the
-- store's own client_address_id (027, pre-existing per-store
-- assignment -- still used by clients not on the per-user-default
-- model), then the store's originally-pinned cin7_address_* fields.
alter table orders
  add column shipping_client_address_id uuid references client_addresses(id) on delete set null;
