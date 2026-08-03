-- 002_seed.sql
-- Seed data for testing RLS. Run this in the Supabase SQL Editor
-- AFTER 001_init_schema.sql.
--
-- NOTE: Supabase auth users normally get created via the Auth API
-- (signup), not raw SQL. For local test data, the simplest approach
-- is to create the auth users first via the dashboard
-- (Authentication -> Users -> Add user), then run this script,
-- substituting in the real UUIDs it generates.
--
-- Below assumes you've already created these 3 auth users via the
-- dashboard and swapped in their real ids:
--   buyer_a@test.com     -> replace BUYER_A_ID
--   admin_a@test.com     -> replace ADMIN_A_ID
--   buyer_b@test.com     -> replace BUYER_B_ID

-- ============================================================
-- Stores
-- ============================================================
insert into stores (id, name, cin7_customer_id) values
  ('11111111-1111-1111-1111-111111111111', 'Store A - Downtown', 'CIN7-CUST-A'),
  ('22222222-2222-2222-2222-222222222222', 'Store B - Uptown', 'CIN7-CUST-B');

-- ============================================================
-- Users (mirrors auth.users - insert matching rows here)
-- Replace the UUIDs below with the real ids from
-- Authentication -> Users in your dashboard.
-- ============================================================
insert into users (id, email, full_name) values
  ('BUYER_A_ID', 'buyer_a@test.com', 'Buyer A'),
  ('ADMIN_A_ID', 'admin_a@test.com', 'Admin A'),
  ('BUYER_B_ID', 'buyer_b@test.com', 'Buyer B');

-- ============================================================
-- Role assignments
-- ============================================================
insert into user_store_roles (user_id, store_id, role) values
  ('BUYER_A_ID', '11111111-1111-1111-1111-111111111111', 'buyer'),
  ('ADMIN_A_ID', '11111111-1111-1111-1111-111111111111', 'store_admin'),
  ('BUYER_B_ID', '22222222-2222-2222-2222-222222222222', 'buyer');

-- ============================================================
-- A test order at Store A, created by Buyer A
-- ============================================================
insert into orders (id, store_id, requested_by, status) values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'BUYER_A_ID',
   'pending_approval');

insert into order_lines (order_id, sku, description, quantity, unit_price) values
  ('33333333-3333-3333-3333-333333333333', 'SKU-001', 'Test widget', 5, 12.50);
