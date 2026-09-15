-- 034_user_image_size_scope.sql
-- Lets a user choose whether the image-size toggle (021) stays one
-- shared value across Catalogue/Cart/Order Detail -- "Same for every
-- page", the existing behaviour and the default here -- or remembers
-- a separate size per page ("Remember per page"), same idea as 031's
-- per-page group-mode columns applied to image size instead. Same
-- table, same self-service RLS (already covers any new column added
-- here -- no policy change needed).
alter table user_preferences
  add column image_size_scope text not null default 'shared' check (image_size_scope in ('shared', 'per_page')),
  add column catalog_image_size text not null default 'small' check (catalog_image_size in ('hide', 'small', 'large')),
  add column cart_image_size text not null default 'small' check (cart_image_size in ('hide', 'small', 'large')),
  add column order_detail_image_size text not null default 'small' check (order_detail_image_size in ('hide', 'small', 'large'));
