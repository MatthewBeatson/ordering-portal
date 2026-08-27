-- 021_user_image_size_preference.sql
-- Per-user persistence for the Catalog/Cart/OrderDetail image-size
-- toggle, so it stays the same as whatever a given user last left it
-- on, next time they log in (any device) -- not just remembered
-- per-browser via localStorage.
--
-- Deliberately a separate table from `users`, not a new column there:
-- this needs a broad, unrestricted self-service RLS policy (any
-- authenticated user can read/write their own row, no backend
-- round-trip needed for something this low-stakes) -- safe here only
-- because this table can never hold anything privilege-relevant.
-- Adding a same-shaped policy directly on `users` would let a client
-- construct a raw PATCH straight to Supabase's REST API and attempt to
-- flip their own is_portal_admin/is_super_admin, which live in that
-- same table.

create table user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  image_size text not null default 'small' check (image_size in ('hide', 'small', 'large')),
  updated_at timestamptz not null default now()
);

alter table user_preferences enable row level security;

create policy "users manage their own preferences"
  on user_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
