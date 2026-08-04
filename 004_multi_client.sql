-- 004_multi_client.sql
-- Adds: clients above stores, a proper portal_admin/client_admin role split,
-- quick-order batches (admin bulk ordering), and a local product/image cache
-- synced from Cin7 (Cin7 has no product images for most SKUs).
--
-- Run this after 001_init_schema.sql. Safe to run on the seeded dev DB from
-- 002_seed.sql, but the seed data doesn't have a client yet — see the note
-- near the bottom.

-- ============================================================
-- Clients
-- One row per client company. Maps 1:1 to a single Cin7 Customer
-- record (the company itself, not any one store/address).
-- ============================================================
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cin7_customer_id text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Stores: add client_id, store_number, and pinned Cin7 address
-- ------------------------------------------------------------
-- Previously stores.cin7_customer_id assumed one Cin7 Customer per
-- store — wrong, since a client's stores share ONE Cin7 Customer
-- record. That mapping now lives on `clients`. Each store instead
-- gets a pinned copy of one of that customer's existing Cin7
-- addresses, set once by a human during onboarding and never
-- auto-matched or auto-created by sync code. See the comment above
-- can_approve() below for why this is deliberate.
-- ============================================================
alter table stores drop column if exists cin7_customer_id;

alter table stores add column client_id uuid references clients(id);
alter table stores add column store_number text;

alter table stores add column cin7_address_line1 text;
alter table stores add column cin7_address_line2 text;
alter table stores add column cin7_address_city text;
alter table stores add column cin7_address_state text;
alter table stores add column cin7_address_postcode text;
alter table stores add column cin7_address_country text;

create index idx_stores_client on stores(client_id);
create unique index idx_stores_client_store_number on stores(client_id, store_number);

-- ============================================================
-- Client-level roles
-- A client_admin can approve/view across every store belonging
-- to their own client — and nothing outside it. This is what was
-- missing before: previously "portal_admin" was checked globally,
-- which would have let one client's admin see another client's
-- orders once a second client existed.
-- ============================================================
create type client_role as enum ('client_admin');

create table user_client_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  role client_role not null default 'client_admin',
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index idx_user_client_roles_user on user_client_roles(user_id);
create index idx_user_client_roles_client on user_client_roles(client_id);

-- ============================================================
-- Portal admin: now a flag on the user, not a store-scoped role.
-- This is your team only (never given to client staff) — global
-- oversight across every client. Previously this lived inside
-- store_role, checked "at any store," which is the bug being
-- fixed by this whole migration.
-- ============================================================
alter table users add column is_portal_admin boolean not null default false;

-- ============================================================
-- Updated access-control functions
-- CREATE OR REPLACE keeps the same signatures the existing RLS
-- policies from 001 already call, so those policies don't need
-- to be touched — they inherit the corrected behavior automatically.
-- ============================================================
create or replace function is_portal_admin()
returns boolean as $$
  select coalesce((select is_portal_admin from users where id = auth.uid()), false);
$$ language sql security definer stable;

create or replace function is_client_admin(target_client_id uuid)
returns boolean as $$
  select exists (
    select 1 from user_client_roles
    where user_id = auth.uid() and client_id = target_client_id
  );
$$ language sql security definer stable;

-- store's client, for functions that only have a store_id
create or replace function client_of_store(target_store_id uuid)
returns uuid as $$
  select client_id from stores where id = target_store_id;
$$ language sql security definer stable;

create or replace function has_store_access(target_store_id uuid)
returns boolean as $$
  select
    is_portal_admin()
    or is_client_admin(client_of_store(target_store_id))
    or exists (
      select 1 from user_store_roles
      where user_id = auth.uid() and store_id = target_store_id
    );
$$ language sql security definer stable;

create or replace function can_approve(target_store_id uuid)
returns boolean as $$
  select
    is_portal_admin()
    or is_client_admin(client_of_store(target_store_id))
    or exists (
      select 1 from user_store_roles
      where user_id = auth.uid()
        and store_id = target_store_id
        and role = 'store_admin'
    );
$$ language sql security definer stable;

-- store_role no longer needs its own 'portal_admin' value —
-- that's now the users.is_portal_admin flag. Left as a comment
-- rather than altering the enum, since removing enum values in
-- Postgres is disruptive; simply stop assigning that value going
-- forward. ('buyer' and 'store_admin' remain valid and in use.)

-- ============================================================
-- Clients: RLS
-- ============================================================
alter table clients enable row level security;

create policy "select clients user belongs to"
  on clients for select
  using (
    is_portal_admin()
    or is_client_admin(id)
    or exists (
      select 1 from user_store_roles usr
      join stores s on s.id = usr.store_id
      where usr.user_id = auth.uid() and s.client_id = clients.id
    )
  );

alter table user_client_roles enable row level security;

create policy "select own client role rows"
  on user_client_roles for select
  using (user_id = auth.uid() or is_portal_admin());

-- ============================================================
-- Order batches (quick-order workflow)
-- One batch = one working session where an admin builds several
-- store orders back-to-back, reviews them together, then submits
-- them all at once. Individual orders still live in `orders` —
-- a batch just groups them and carries the submit-all action.
-- ============================================================
create type order_batch_status as enum ('building', 'reviewed', 'submitted');
create type order_source as enum ('catalog', 'quick_order');

create table order_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references users(id),
  status order_batch_status not null default 'building',
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table orders add column batch_id uuid references order_batches(id);
alter table orders add column source order_source not null default 'catalog';
-- Generated once when the order is created within a batch, e.g.
-- "#123 (04.08.26) admin_user" — stored explicitly so what the
-- admin reviews on screen is exactly what gets sent to Cin7 as
-- the Sales Order reference, with no re-derivation at sync time.
alter table orders add column cin7_reference text;

create index idx_orders_batch on orders(batch_id);

alter table order_batches enable row level security;

create policy "select own batches"
  on order_batches for select
  using (created_by = auth.uid() or is_portal_admin());

create policy "insert own batches"
  on order_batches for insert
  with check (created_by = auth.uid());

create policy "update own batches while building"
  on order_batches for update
  using (created_by = auth.uid() or is_portal_admin());

-- Note: the backend must check can_approve(store_id) for every
-- order in a batch before allowing status -> 'submitted'. Quick-order
-- orders are created by someone who already holds approval rights, so
-- they can move straight to 'approved' on submit rather than sitting
-- in 'pending_approval' — that's an application-layer rule enforced
-- by the backend API, not a DB constraint.

-- ============================================================
-- Product catalog cache
-- Synced from Cin7 on a schedule (see earlier discussion — never
-- queried live from the frontend). Images live here too, since
-- Cin7 has none for most SKUs; uploaded manually via an admin
-- screen and matched by SKU.
-- ============================================================
create table products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  cin7_product_id text unique,
  name text not null,
  description text,
  category text,
  family text,
  brand text,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_products_category on products(category);
create index idx_products_family on products(family);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  sku text not null references products(sku) on delete cascade,
  storage_path text not null,     -- path within Supabase Storage
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index idx_product_images_sku on product_images(sku);

alter table products enable row level security;
alter table product_images enable row level security;

-- Catalog data isn't client-specific (shared vendor catalog), so any
-- authenticated portal user can read it. Client-specific pricing is
-- NOT stored here — that's a separate concern (Cin7 price tiers),
-- deliberately left out of this cache to avoid one client seeing
-- pricing derived for another.
create policy "authenticated users can view products"
  on products for select
  using (auth.uid() is not null);

create policy "authenticated users can view product images"
  on product_images for select
  using (auth.uid() is not null);

-- ============================================================
-- Note on existing seed data (002_seed.sql)
-- ============================================================
-- The two seed stores don't have a client_id yet. Before re-running
-- the RLS tests from 003, insert a client and backfill:
--
--   insert into clients (id, name, cin7_customer_id)
--     values ('44444444-4444-4444-4444-444444444444', 'Test Client Co', 'CIN7-CUST-TEST');
--
--   update stores set client_id = '44444444-4444-4444-4444-444444444444'
--     where id in (
--       '11111111-1111-1111-1111-111111111111',
--       '22222222-2222-2222-2222-222222222222'
--     );
