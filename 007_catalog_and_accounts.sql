-- 007_catalog_and_accounts.sql
-- Phase 5: schema fields needed for a future public storefront and
-- display-builder tool sharing this same backend. Not actively used
-- by the portal yet, added now while the schema is still young.

-- ============================================================
-- products: visibility + client ownership + display grouping
-- ============================================================
alter table products add column visibility text not null default 'client_exclusive';
-- 'public' | 'client_exclusive'

-- Nullable: null = not tied to any one client (a shared/public product).
-- Naming matches stores.client_id's existing convention.
alter table products add column client_id uuid references clients(id);

-- Nullable grouping key so the frontend can toggle "by product type"
-- (products.category, already existed) vs "by display system". Plain
-- text for now; can become a proper reference table later if display
-- systems need their own managed list.
alter table products add column display_system_id text;

create index idx_products_client on products(client_id);
create index idx_products_visibility on products(visibility);

-- ============================================================
-- clients: payment_terms -- settable only by Shonrei staff (service
-- role), never self-service. Not used by the portal yet (portal
-- clients are on credit terms via Cin7 invoicing) -- needed for the
-- future storefront's checkout logic.
-- ============================================================
alter table clients add column payment_terms text; -- 'card' | 'credit_account'

-- No RLS insert/update policy is added for this column from client-side
-- roles -- only the backend (service_role, bypasses RLS) can set it,
-- same pattern as order_events being backend-write-only.

-- ============================================================
-- product_images: refactor from the 004 version (sku-keyed, no
-- alt_text/display_order) to a product_id-keyed shared table so a
-- future storefront and display builder can reuse the same images.
-- Table is confirmed empty (0 rows) -- clean redefinition, not a
-- data migration.
-- ============================================================
alter table product_images drop column sku;
alter table product_images add column product_id uuid references products(id) on delete cascade;
alter table product_images add column alt_text text;
alter table product_images add column display_order int not null default 0;

alter table product_images alter column product_id set not null;

create index idx_product_images_product on product_images(product_id);
