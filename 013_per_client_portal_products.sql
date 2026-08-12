-- 013_per_client_portal_products.sql
-- Product curation moves from one global "added_to_portal" flag to a
-- per-client mapping -- confirmed with user 2026-08-12: large clients
-- can have genuinely different product ranges, not just different SKU
-- labels on a shared list (that per-client-label need was already
-- handled by client_product_skus in 010, which is a separate concern
-- from *visibility*). client_portal_products is the new source of
-- truth for "is this product visible to this client"; the old global
-- products.added_to_portal is dropped.

create table client_portal_products (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references users(id),
  unique (client_id, product_id)
);

create index idx_client_portal_products_client on client_portal_products(client_id);
create index idx_client_portal_products_product on client_portal_products(product_id);

alter table client_portal_products enable row level security;

-- Same "belongs to this client" shape as client_product_skus (010).
create policy "select portal products for own client"
  on client_portal_products for select
  using (
    is_portal_admin()
    or is_client_admin(client_id)
    or exists (
      select 1 from user_store_roles usr
      join stores s on s.id = usr.store_id
      where usr.user_id = auth.uid() and s.client_id = client_portal_products.client_id
    )
  );

-- No INSERT/UPDATE/DELETE policy for client-side roles -- staff-only,
-- via the backend's service_role client (same lockdown pattern as 009).

-- Helper: is target_product_id visible to the current user via ANY
-- client they belong to that has curated it onto their own portal?
create or replace function product_visible_to_user(target_product_id uuid)
returns boolean as $$
  select exists (
    select 1 from client_portal_products cpp
    where cpp.product_id = target_product_id
      and (
        is_client_admin(cpp.client_id)
        or exists (
          select 1 from user_store_roles usr
          join stores s on s.id = usr.store_id
          where usr.user_id = auth.uid() and s.client_id = cpp.client_id
        )
      )
  );
$$ language sql security definer stable;

drop policy "select portal-curated products, or all for staff" on products;
create policy "select products curated for user's client, or all for staff"
  on products for select
  using (is_portal_admin() or product_visible_to_user(id));

drop policy "select images for portal-curated products, or all for staff" on product_images;
create policy "select images for products curated for user's client, or all for staff"
  on product_images for select
  using (is_portal_admin() or product_visible_to_user(product_id));

drop index if exists idx_products_added_to_portal;
alter table products drop column added_to_portal;
