-- 012_product_taxonomy_and_pricing.sql
-- Two decisions confirmed with user (2026-08-07):
--
-- 1. Taxonomy: display_system is synced FROM Cin7's own category field
--    (upserted by the sync job as new categories appear); product_type
--    (tray/insert/bracket/plinth-base) is a genuinely new, Shonrei-only
--    concept with no Cin7 equivalent. Both get proper reference tables
--    now rather than free text, since no product data exists yet to
--    migrate -- avoids typo-created phantom groups and gives a future
--    admin screen a clean place to rename/reorder them.
--
-- 2. Pricing: Cin7 natively supports up to 10 numbered price tiers per
--    product (confirmed directly against the trial account: products
--    carry PriceTier1..PriceTier10, customers carry a PriceTier
--    assignment like "Tier 2"). Two of the portal's clients share tier
--    2, another is on tier 3. Rather than the portal ever guessing/
--    computing a price, the sync job caches each product's per-tier
--    prices, and each client records which tier applies to them.

-- ============================================================
-- Taxonomy reference tables
-- ============================================================
create table product_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create table display_systems (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Raw Cin7 category value this was synced from. Sync job upserts on
  -- this; `name` starts as a copy of it but is separately editable by
  -- staff afterward if Cin7's raw value isn't display-ready.
  cin7_category_value text unique,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table product_types enable row level security;
alter table display_systems enable row level security;

-- Reference/lookup data -- any authenticated user can read (needed to
-- render filter chips/dropdowns); no client-side write policy, same
-- backend-only pattern as everything else added recently.
create policy "select product types" on product_types for select using (auth.uid() is not null);
create policy "select display systems" on display_systems for select using (auth.uid() is not null);

-- ============================================================
-- products: swap display_system_id from free text (007) to a real FK,
-- add product_type_id, add the 10 Cin7 price-tier columns.
-- ============================================================
alter table products drop column display_system_id; -- was free text, table is empty, safe to redefine
alter table products add column display_system_id uuid references display_systems(id);
alter table products add column product_type_id uuid references product_types(id);

create index idx_products_display_system on products(display_system_id);
create index idx_products_product_type on products(product_type_id);

alter table products add column price_tier_1 numeric;
alter table products add column price_tier_2 numeric;
alter table products add column price_tier_3 numeric;
alter table products add column price_tier_4 numeric;
alter table products add column price_tier_5 numeric;
alter table products add column price_tier_6 numeric;
alter table products add column price_tier_7 numeric;
alter table products add column price_tier_8 numeric;
alter table products add column price_tier_9 numeric;
alter table products add column price_tier_10 numeric;

-- ============================================================
-- clients: which Cin7 price tier applies to this client
-- ============================================================
alter table clients add column cin7_price_tier text; -- e.g. 'Tier 2', matches Cin7's own naming
