-- 026_products_jewellery_count.sql
-- Confirmed with the client (2026-09-02): jewellery_count moves from
-- "purely per-client, no global default" (022's original model) to the
-- same global-default + per-client-override shape as product_type/
-- jewellery_type/colour (024) -- most products' jewellery count is the
-- same for every client, staff can still override it for a specific
-- client via client_product_attributes.jewellery_count when it
-- genuinely differs (e.g. a client's own insert/layout choice).
alter table products add column jewellery_count integer check (jewellery_count is null or jewellery_count >= 0);

comment on column products.jewellery_count is
  'Global default jewellery-item capacity for this product (how many pieces it holds). client_product_attributes.jewellery_count overrides this per client when set (non-null) -- same resolution pattern as product_type_id/jewellery_type_id/colour_id.';
