-- 017_product_colours.sql
-- Fourth grouping/filter axis, same shape as product_types (016): a
-- managed reference table synced from a Cin7 Additional Attribute
-- (3 -- 2 went to product_jewellery_types instead, see 018), with its
-- own staff-editable name/display_order and a stable sync anchor so
-- renaming in Supabase doesn't break the link back to Cin7.

create table product_colours (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order int not null default 0,
  cin7_attribute_value text unique,
  created_at timestamptz not null default now()
);

comment on column product_colours.cin7_attribute_value is
  'The exact Cin7 AdditionalAttribute3 value this colour was created from. Sync anchor -- name is free to rename afterward. Null for colours created manually in Supabase, not from a sync.';

alter table products add column colour_id uuid references product_colours(id);
create index idx_products_colour on products(colour_id);

alter table product_colours enable row level security;

-- Same "any authenticated user can read" shape as product_types/
-- display_systems (012) -- this is shared reference/grouping data, not
-- client- or curation-scoped.
create policy "select product colours"
  on product_colours for select
  using (auth.uid() is not null);

-- No client-side write policy -- staff-only, via the sync job's
-- service_role client, same pattern as product_types/display_systems.
