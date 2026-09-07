-- Staff-managed rules for Catalog/Cart/Order Detail's 3rd grouping
-- mode ("Custom"): pairs a tray/base product with the specific insert
-- products that should always be listed directly under it, regardless
-- of display system or product type -- e.g. tray MT20012EBUSS always
-- shows its M150... inserts nested directly beneath it. Global (not
-- per-client), same as product_types/product_colours/display_systems --
-- one shared rule set, staff-editable.
--
-- Exact product pairs (not SKU-pattern matching) -- one row per
-- tray/insert pair, display_order controls the insert's position
-- under that tray. A tray with no rows here just isn't part of any
-- custom group (falls to "Ungrouped" in that view, same as any other
-- unclassified product elsewhere in the app).
create table custom_group_rules (
  id uuid primary key default gen_random_uuid(),
  tray_product_id uuid not null references products(id) on delete cascade,
  insert_product_id uuid not null references products(id) on delete cascade,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tray_product_id, insert_product_id),
  check (tray_product_id <> insert_product_id)
);

create index custom_group_rules_tray_idx on custom_group_rules (tray_product_id);

-- Select-only RLS, same convention as every other staff-managed
-- reference/override table (023, 024, 028) -- any authenticated user
-- can read (buyers need this to render the Custom view), all writes go
-- through the backend's service_role client with a staff-only check.
alter table custom_group_rules enable row level security;
create policy "custom_group_rules_select" on custom_group_rules for select using (true);
