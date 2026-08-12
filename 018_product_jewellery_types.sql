-- 018_product_jewellery_types.sql
-- Third grouping/filter axis: what jewellery item a display fixture
-- holds (Ring, Earring, Pendant, ...) -- prioritised over colour
-- (017), which moved to Attribute 3 to make room for this on
-- Attribute 2. Same shape as product_types (016) and product_colours
-- (017): managed reference table, staff-editable name/display_order,
-- stable Cin7 sync anchor.

create table product_jewellery_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order int not null default 0,
  cin7_attribute_value text unique,
  created_at timestamptz not null default now()
);

comment on column product_jewellery_types.cin7_attribute_value is
  'The exact Cin7 AdditionalAttribute2 value this jewellery type was created from. Sync anchor -- name is free to rename afterward. Null for types created manually in Supabase, not from a sync.';

alter table products add column jewellery_type_id uuid references product_jewellery_types(id);
create index idx_products_jewellery_type on products(jewellery_type_id);

alter table product_jewellery_types enable row level security;

create policy "select product jewellery types"
  on product_jewellery_types for select
  using (auth.uid() is not null);

-- No client-side write policy -- staff-only, via the sync job's
-- service_role client, same pattern as product_types/product_colours.
