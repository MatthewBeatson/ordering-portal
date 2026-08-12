-- 016_product_type_sync_anchor.sql
-- product_types needs a stable Cin7-side anchor to sync against, same
-- reasoning as display_systems.cin7_category_value (007/012): staff
-- should be able to rename product_types.name for display purposes
-- without breaking the link back to whatever Cin7 Additional
-- Attribute value it was created from. (Started out targeting
-- Attribute 10, switched to Attribute 1 before any real sync ran --
-- see productSync.js.)

alter table product_types add column cin7_attribute_value text unique;

comment on column product_types.cin7_attribute_value is
  'The exact Cin7 AdditionalAttribute1 value this type was created from. Sync anchor -- product_types.name is free to rename afterward. Null for types created manually in Supabase, not from a sync.';
