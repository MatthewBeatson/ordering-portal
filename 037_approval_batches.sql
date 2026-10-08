-- 037_approval_batches.sql
-- Records each bulk approval ("Confirm N selected" on the Approvals page) as
-- a group, so the approver and Shonrei can look back at exactly which orders
-- were approved together, when, and by whom -- and so the notification email
-- can link to a permanent confirmation page.
--
-- Not to be confused with order_batches (001), which is the separate,
-- not-yet-built quick-order feature.
--
-- Written and read only through the backend (service_role bypasses RLS), same
-- trust-boundary convention as the rest of the order workflow (see 009): RLS
-- is enabled with NO policies, so a direct Supabase call with a user's own JWT
-- can't read or write it. Per-user visibility is enforced in
-- backend/src/services/approvalBatches.js.

create table approval_batches (
  id uuid primary key default gen_random_uuid(),
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz not null default now(),
  confirmed_count integer not null,
  -- Orders that were selected but not approved: [{ id, reason }]
  skipped jsonb not null default '[]'::jsonb,
  -- 'pending' until the send attempt finishes. 'not_configured' = no email
  -- provider set up yet (the batch and page still exist).
  email_status text not null default 'pending'
    check (email_status in ('pending', 'sent', 'failed', 'not_configured')),
  email_recipients text[] not null default '{}',
  email_error text,
  created_at timestamptz not null default now()
);

alter table approval_batches enable row level security;

alter table orders add column approval_batch_id uuid references approval_batches(id) on delete set null;

create index idx_orders_approval_batch on orders(approval_batch_id) where approval_batch_id is not null;
create index idx_approval_batches_approved_at on approval_batches(approved_at desc);
