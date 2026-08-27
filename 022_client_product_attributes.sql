-- 022_client_product_attributes.sql
-- Per-client product overrides -- deliberately separate from `products`
-- (which stays Cin7-sourced and global: product_type, jewellery_type
-- category, and colour are all genuinely fixed properties of the
-- physical SKU, confirmed with the client -- colour is even baked
-- directly into the SKU itself, e.g. AUL20162CAVBK/...NV for black/navy).
--
-- This table is for the opposite case: data that's the SAME product
-- but can legitimately differ by which client is asking, starting with
-- jewellery_count (how many pieces a given tray/fixture holds -- can
-- vary by a client's own insert/layout choice for the same physical
-- SKU, unlike product_type/colour). NULL in any column here means "no
-- override for this client -- nothing to show," not zero.
--
-- Built to grow in two, deliberately different, cheap ways:
--   - a new GLOBAL attribute later -> a new column on `products` (same
--     pattern product_type_id/jewellery_type_id/colour_id already use)
--   - a new PER-CLIENT attribute later -> a new nullable column here
-- Neither case needs a new table or a redesign, just one more column.

create table client_product_attributes (
  client_id uuid not null references clients(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  jewellery_count integer check (jewellery_count is null or jewellery_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, product_id)
);

create index idx_client_product_attributes_product on client_product_attributes(product_id);

comment on table client_product_attributes is
  'Per-(client, product) overrides for data that legitimately varies by client, unlike products'' own global Cin7-sourced classification (product_type/jewellery_type/colour). Add a new nullable column here for each new per-client attribute; add a new column on products instead for anything that''s the same for every client.';

alter table client_product_attributes enable row level security;

-- Same lockdown shape as everywhere else in this project: staff manage
-- this through the backend (service_role, not added yet -- read-only
-- via RLS for now until a curation UI exists), clients can read only
-- their own client's rows, scoped through the same client_id checks
-- the rest of the schema already uses.
create policy "clients can view their own product attribute overrides"
  on client_product_attributes for select
  using (
    exists (
      select 1 from user_client_roles ucr where ucr.client_id = client_product_attributes.client_id and ucr.user_id = auth.uid()
    )
    or exists (
      select 1 from user_store_roles usr join stores s on s.id = usr.store_id
      where s.client_id = client_product_attributes.client_id and usr.user_id = auth.uid()
    )
    or is_portal_admin()
  );
