-- 010_client_product_skus.sql
-- Per-client SKU codes for products. A client's own reference code for
-- a shared product varies client-to-client (confirmed with user
-- 2026-08-07: Client A and Client B can each have their own SKU for
-- the same shared product, and a client might not have one at all yet
-- if they've never ordered that product) -- this can't live as a
-- single column on products, needs a proper mapping table.

create table client_product_skus (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  client_sku text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, product_id)
);

create index idx_client_product_skus_client on client_product_skus(client_id);
create index idx_client_product_skus_product on client_product_skus(product_id);

create trigger trg_client_product_skus_updated_at
  before update on client_product_skus
  for each row execute function set_updated_at();

alter table client_product_skus enable row level security;

-- Same "belongs to this client" shape as the existing clients SELECT
-- policy (004_multi_client.sql) -- a user sees client-SKU rows only
-- for client(s) they actually belong to.
create policy "select client product skus for own client"
  on client_product_skus for select
  using (
    is_portal_admin()
    or is_client_admin(client_id)
    or exists (
      select 1 from user_store_roles usr
      join stores s on s.id = usr.store_id
      where usr.user_id = auth.uid() and s.client_id = client_product_skus.client_id
    )
  );

-- No INSERT/UPDATE policy for client-side roles -- assumed Shonrei-staff-
-- managed for now (same pattern as clients.payment_terms), not
-- client self-service. Flag if that assumption is wrong; easy to add
-- a client_admin-scoped write policy later if clients should be able
-- to set their own SKUs directly.
