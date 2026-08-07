-- 006_provider_agnostic_orders.sql
-- Phase 5: provider-agnostic order status + review hold + shipped +
-- cancellation-request fields. Also moves Cin7-specific sync outcome
-- data off the orders table entirely, into a new provider-agnostic
-- inventory_sync table.
--
-- Verified against live Supabase before writing this migration
-- (information_schema check): all existing orders are test/seed data,
-- none has a real Cin7 sync recorded -- safe to remap order_status
-- values with no real-data loss risk.

-- ============================================================
-- 1. Recreate order_status as a clean provider-agnostic enum.
-- Postgres has no DROP VALUE for enums, so a plain ADD VALUE would
-- leave the old Cin7-shaped values (draft/pending_approval/approved/
-- synced_to_cin7/sync_failed) permanently in the type. Recreating the
-- type instead gives a clean set with nothing left over.
-- ============================================================
create type order_status_new as enum (
  'pending', 'confirmed', 'in_progress', 'shipped', 'delivered', 'rejected'
);

alter table orders alter column status drop default;

alter table orders
  alter column status type order_status_new
  using (
    case status::text
      when 'draft' then 'pending'
      when 'pending_approval' then 'pending'
      when 'approved' then 'confirmed'
      when 'rejected' then 'rejected'
      when 'synced_to_cin7' then 'in_progress'
      -- sync outcome now lives in inventory_sync, not order_status --
      -- a failed sync leaves the order at 'confirmed', not a distinct
      -- Cin7-flavoured status.
      when 'sync_failed' then 'confirmed'
    end
  )::order_status_new;

alter table orders alter column status set default 'pending'::order_status_new;

drop type order_status;
alter type order_status_new rename to order_status;

-- ============================================================
-- 2. inventory_sync -- generic provider-agnostic sync outcome
-- tracking. Replaces orders.cin7_sales_order_id / cin7_sync_error.
-- Swapping inventory providers later means a new adapter writing to
-- this same table, not a schema rebuild.
-- ============================================================
create table inventory_sync (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null,                    -- e.g. 'cin7'
  external_id text,                          -- Cin7 Sale ID once known
  status text not null default 'pending',    -- pending | synced | failed
  error_message text,
  raw_payload jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, provider)
);

create index idx_inventory_sync_order on inventory_sync(order_id);
create index idx_inventory_sync_external_id on inventory_sync(external_id);

create trigger trg_inventory_sync_updated_at
  before update on inventory_sync
  for each row execute function set_updated_at();

alter table inventory_sync enable row level security;

-- Read-only from the client, scoped through the parent order's access
-- rule -- same shape as order_events. Only the backend (service role,
-- bypasses RLS) writes to this table.
create policy "select inventory_sync via parent order access"
  on inventory_sync for select
  using (
    exists (
      select 1 from orders o
      where o.id = inventory_sync.order_id
        and (has_store_access(o.store_id) or is_portal_admin())
    )
  );

-- ============================================================
-- 3. Drop Cin7-specific columns from orders now that inventory_sync
-- exists (confirmed empty of real data -- see migration header).
-- ============================================================
alter table orders drop column if exists cin7_sales_order_id;
alter table orders drop column if exists cin7_sync_error;

-- cin7_reference -> reference: it's a reference *we* generate and send
-- to Cin7, not a Cin7-owned field -- doesn't belong under a cin7_ prefix.
alter table orders rename column cin7_reference to reference;

-- ============================================================
-- 4. Review hold (flagged_for_review). While true, an order stays at
-- 'confirmed' and the sync module skips it entirely until a Shonrei
-- admin clears the flag. Internal-only -- never exposed client-side.
-- ============================================================
alter table orders add column flagged_for_review boolean not null default false;
alter table orders add column flagged_reason text;
alter table orders add column flagged_by uuid references users(id);
alter table orders add column reviewed_by uuid references users(id);
alter table orders add column reviewed_at timestamptz;

-- ============================================================
-- 5. Shipped status fields
-- ============================================================
alter table orders add column shipped_at timestamptz;
alter table orders add column shipped_source text; -- 'manual' | 'auto_invoice'
alter table orders add column shipped_by uuid references users(id); -- null for auto_invoice

-- ============================================================
-- 6. Cancellation-request flow (post-confirm/post-sync). Pre-sync
-- self-service cancel stays a plain delete of a 'pending' order --
-- enforced in backend code, not a DB constraint, to keep this
-- migration purely additive.
-- ============================================================
alter table orders add column cancellation_requested_at timestamptz;
alter table orders add column cancellation_requested_by uuid references users(id);
alter table orders add column cancellation_reason text;
alter table orders add column cancellation_status text; -- 'requested' | 'approved' | 'denied'
alter table orders add column cancellation_resolved_at timestamptz;
alter table orders add column cancellation_resolved_by uuid references users(id);
