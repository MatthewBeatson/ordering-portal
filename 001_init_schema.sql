-- 001_init_schema.sql
-- Initial schema for multi-store B2B ordering portal
-- Run via Supabase CLI: supabase migration new init_schema, then paste this in,
-- or `supabase db push` against your project.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ============================================================
-- Enums
-- ============================================================
create type store_role as enum ('buyer', 'store_admin', 'portal_admin');
create type order_status as enum (
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'synced_to_cin7',
  'sync_failed'
);

-- ============================================================
-- Stores
-- One row per client store/location. Maps to a Cin7 customer
-- or location record via cin7_customer_id.
-- ============================================================
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cin7_customer_id text unique,       -- Cin7's identifier for this store/customer
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Users
-- Mirrors auth.users (Supabase Auth). One row per portal user,
-- keyed by the auth user id.
-- ============================================================
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- User <-> Store roles (many-to-many)
-- This is what RLS policies key off. A user can belong to
-- multiple stores with different roles.
-- ============================================================
create table user_store_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  role store_role not null default 'buyer',
  created_at timestamptz not null default now(),
  unique (user_id, store_id)
);

create index idx_user_store_roles_user on user_store_roles(user_id);
create index idx_user_store_roles_store on user_store_roles(store_id);

-- ============================================================
-- Orders
-- ============================================================
create table orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  requested_by uuid not null references users(id),
  approved_by uuid references users(id),
  status order_status not null default 'draft',
  cin7_sales_order_id text,           -- set once synced
  cin7_sync_error text,               -- last error message, if sync_failed
  idempotency_key uuid not null default gen_random_uuid(), -- guards against duplicate SO creation
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_orders_store on orders(store_id);
create index idx_orders_status on orders(status);
create unique index idx_orders_idempotency on orders(idempotency_key);

-- ============================================================
-- Order lines
-- ============================================================
create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  sku text not null,
  description text,
  quantity numeric not null check (quantity > 0),
  unit_price numeric,
  created_at timestamptz not null default now()
);

create index idx_order_lines_order on order_lines(order_id);

-- ============================================================
-- Order events (audit trail)
-- Every status transition and admin action gets logged here.
-- Never delete rows from this table.
-- ============================================================
create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  actor_id uuid references users(id),      -- null for system/automated events
  event_type text not null,                -- e.g. 'created', 'approved', 'rejected', 'synced', 'sync_failed'
  detail jsonb,
  created_at timestamptz not null default now()
);

create index idx_order_events_order on order_events(order_id);

-- ============================================================
-- updated_at trigger for orders
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
alter table stores enable row level security;
alter table users enable row level security;
alter table user_store_roles enable row level security;
alter table orders enable row level security;
alter table order_lines enable row level security;
alter table order_events enable row level security;

-- Helper: does the current user have a role (any role) at a given store?
create or replace function has_store_access(target_store_id uuid)
returns boolean as $$
  select exists (
    select 1 from user_store_roles
    where user_id = auth.uid() and store_id = target_store_id
  );
$$ language sql security definer stable;

-- Helper: is the current user a portal_admin at ANY store
-- (adjust if portal_admin should be global rather than per-store)
create or replace function is_portal_admin()
returns boolean as $$
  select exists (
    select 1 from user_store_roles
    where user_id = auth.uid() and role = 'portal_admin'
  );
$$ language sql security definer stable;

-- Helper: is the current user a store_admin (or portal_admin) at a given store?
create or replace function can_approve(target_store_id uuid)
returns boolean as $$
  select exists (
    select 1 from user_store_roles
    where user_id = auth.uid()
      and store_id = target_store_id
      and role in ('store_admin', 'portal_admin')
  ) or is_portal_admin();
$$ language sql security definer stable;

-- ---- stores ----
create policy "select stores user has access to"
  on stores for select
  using (has_store_access(id) or is_portal_admin());

-- ---- users ----
create policy "select own user row"
  on users for select
  using (id = auth.uid() or is_portal_admin());

-- ---- user_store_roles ----
create policy "select own role rows"
  on user_store_roles for select
  using (user_id = auth.uid() or is_portal_admin());

-- ---- orders ----
create policy "select orders for accessible stores"
  on orders for select
  using (has_store_access(store_id) or is_portal_admin());

create policy "insert orders for own store"
  on orders for insert
  with check (has_store_access(store_id) and requested_by = auth.uid());

create policy "update orders: approvers only, accessible store"
  on orders for update
  using (can_approve(store_id))
  with check (can_approve(store_id));

-- ---- order_lines ----
create policy "select order lines via parent order access"
  on order_lines for select
  using (
    exists (
      select 1 from orders o
      where o.id = order_lines.order_id
        and (has_store_access(o.store_id) or is_portal_admin())
    )
  );

create policy "insert order lines via parent order access"
  on order_lines for insert
  with check (
    exists (
      select 1 from orders o
      where o.id = order_lines.order_id
        and has_store_access(o.store_id)
        and o.requested_by = auth.uid()
    )
  );

-- ---- order_events ----
-- Read-only from the client; all inserts go through the backend
-- using the service role, which bypasses RLS.
create policy "select order events via parent order access"
  on order_events for select
  using (
    exists (
      select 1 from orders o
      where o.id = order_events.order_id
        and (has_store_access(o.store_id) or is_portal_admin())
    )
  );

-- Note: no insert/update/delete policies are defined for order_events
-- from the client side by design — only the backend (service role,
-- which bypasses RLS) should write audit events.
