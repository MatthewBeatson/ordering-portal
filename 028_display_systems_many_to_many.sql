-- 028_display_systems_many_to_many.sql
-- Confirmed with the client (2026-09-02): display_system becomes
-- portal-native (Cin7 Category sync retired, same as Attributes 1-3
-- in 023) AND many-to-many -- a product can belong to more than one
-- display system, unlike product_type/jewellery_type/colour which
-- stay one-per-product. Existing Category-sourced assignments are
-- wiped (explicit "wipe and reassign from scratch" decision, same
-- shape as 023) -- products.display_system_id is dropped entirely in
-- favour of a join table, rather than kept as an unused legacy column.

-- Sync anchor is meaningless once productSync.js stops writing
-- Category -> display_system_id.
alter table display_systems drop column cin7_category_value;

-- Now portal-native (staff-typed) -- same uniqueness guarantee the
-- other three taxonomy tables have, so the admin CRUD can't create
-- accidental duplicates. (Checked live data first -- no pre-existing
-- duplicate names.)
alter table display_systems add constraint display_systems_name_key unique (name);

-- The old scalar FK -- superseded by product_display_systems below.
drop index if exists idx_products_display_system;
alter table products drop column display_system_id;

create table product_display_systems (
  product_id uuid not null references products(id) on delete cascade,
  display_system_id uuid not null references display_systems(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, display_system_id)
);

create index idx_product_display_systems_display_system on product_display_systems(display_system_id);

alter table product_display_systems enable row level security;

-- Same shape as every other portal-native taxonomy table: global
-- reference/grouping data, any authenticated user can read (needed to
-- render Catalog's grouping/filter chips), no client-side write policy
-- -- staff-only, via the backend's service_role client.
create policy "select product display systems"
  on product_display_systems for select
  using (auth.uid() is not null);

comment on table product_display_systems is
  'Many-to-many: which display system(s) a product belongs to. Portal-native (028) -- no longer Cin7 Category-sourced. A product with zero rows here is "Ungrouped" in the By-display-system view, same convention as the other taxonomy facets.';
