-- 008_webhook_log.sql
-- Raw log of every incoming webhook call, regardless of provider,
-- event type, or whether it was actually handled. Added specifically
-- to diagnose whether Cin7 webhooks fire at all on a trial account
-- (no visibility otherwise -- Cin7's API exposes no delivery log, and
-- this dev environment has no access to Render's server logs). Useful
-- ongoing observability for any future provider's webhooks too, not
-- just this diagnostic.

create table webhook_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text,
  raw_payload jsonb,
  received_at timestamptz not null default now()
);

create index idx_webhook_log_provider on webhook_log(provider);
create index idx_webhook_log_received_at on webhook_log(received_at);

-- No RLS policy needed for client-side access -- this is an internal
-- diagnostic table, only ever written/read by the backend (service
-- role, bypasses RLS).
alter table webhook_log enable row level security;
