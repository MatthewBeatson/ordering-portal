-- Per-user, per-page persistence for the "By display system" / "By
-- product type" / "Custom" grouping toggle on Catalog, Cart, and Order
-- Detail -- each page remembers whichever mode a given user last left
-- IT on, same "next login, any device" persistence as the existing
-- image_size preference (021), same table, same self-service RLS
-- (already covers any new column added here -- no policy change
-- needed).
alter table user_preferences
  add column catalog_group_mode text not null default 'display' check (catalog_group_mode in ('display', 'type', 'custom')),
  add column cart_group_mode text not null default 'display' check (cart_group_mode in ('display', 'type', 'custom')),
  add column order_detail_group_mode text not null default 'display' check (order_detail_group_mode in ('display', 'type', 'custom'));
