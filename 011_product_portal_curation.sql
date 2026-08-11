-- 011_product_portal_curation.sql
-- Products get fully mirrored from Cin7 (every SKU), but only a
-- curated subset should ever be visible/orderable on the portal.
-- added_to_portal is that curation flag -- separate from is_active
-- (which reflects Cin7's own active/discontinued state, not whether
-- Shonrei has chosen to list it here).

alter table products add column added_to_portal boolean not null default false;
create index idx_products_added_to_portal on products(added_to_portal);

-- Non-staff only ever see curated products. Portal admins see
-- everything, including the not-yet-added bulk of the Cin7 mirror --
-- needed for the curation/bulk-add screen to search across it.
drop policy "authenticated users can view products" on products;
create policy "select portal-curated products, or all for staff"
  on products for select
  using (added_to_portal or is_portal_admin());

-- Same shape for product_images, via the parent product.
drop policy "authenticated users can view product images" on product_images;
create policy "select images for portal-curated products, or all for staff"
  on product_images for select
  using (
    exists (
      select 1 from products p
      where p.id = product_images.product_id
        and (p.added_to_portal or is_portal_admin())
    )
  );

-- No INSERT/UPDATE/DELETE policy on products for client-side roles --
-- consistent with the orders/order_lines lockdown (009). The Cin7
-- sync job and the (not yet built) staff add-to-portal/bulk-add
-- actions both go through the backend's service_role client.
