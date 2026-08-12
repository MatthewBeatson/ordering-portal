-- 014_client_addresses.sql
-- Mirrors a client's Cin7 customer addresses (confirmed real via the
-- live API: Customer.Addresses is a genuine collection with Type/
-- DefaultForType, not something we invented) into Supabase so the
-- portal can show/use them without a live Cin7 call on every page
-- load. Replaces the old assumption of exactly one manually-pinned
-- address per store with "whatever Cin7 actually has for this client."
--
-- This pass: table + sync + read-only display of the default address.
-- Letting a buyer pick a non-default address per order, and feeding
-- that choice into the Cin7 Sale at sync time, is a further step (see
-- BACKLOG.md) -- not built yet.

create table client_addresses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  cin7_address_id text not null,
  type text not null,              -- 'Shipping' | 'Billing' | 'Business' (Cin7's own values)
  is_default boolean not null default false,
  line1 text not null,
  line2 text,
  city text,
  state text,
  postcode text,
  country text,
  synced_at timestamptz not null default now(),
  unique (client_id, cin7_address_id)
);

create index idx_client_addresses_client on client_addresses(client_id);

alter table client_addresses enable row level security;

-- Same "belongs to this client" shape as client_product_skus (010) /
-- client_portal_products (013).
create policy "select addresses for own client"
  on client_addresses for select
  using (
    is_portal_admin()
    or is_client_admin(client_id)
    or exists (
      select 1 from user_store_roles usr
      join stores s on s.id = usr.store_id
      where usr.user_id = auth.uid() and s.client_id = client_addresses.client_id
    )
  );

-- No INSERT/UPDATE/DELETE policy for client-side roles -- only the
-- backend's sync job (service_role) writes here, same lockdown pattern
-- as everywhere else.
