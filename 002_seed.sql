-- 002_seed.sql (replaces the previous version)
-- Seed data covering 2 clients / 3 stores / all 4 role types, so the
-- RLS tests in 003 can prove client-level isolation, not just store-level.
--
-- Run this in the Supabase SQL Editor AFTER 001 and 004 have both been
-- applied. If you're re-running this on a DB seeded by the OLD version
-- of this file, clear it first:
--
--   truncate table order_events, order_lines, orders, user_client_roles,
--     user_store_roles, order_batches, product_images, products,
--     stores, clients, users cascade;
--
-- Before running: create these 6 auth users via the dashboard
-- (Authentication -> Users -> Add user) and substitute their real
-- UUIDs for the placeholders below.
--   buyer_a@test.com         -> BUYER_A_ID      (buyer, Store A)
--   admin_a@test.com         -> ADMIN_A_ID      (store_admin, Store A)
--   buyer_b@test.com         -> BUYER_B_ID      (buyer, Store B)
--   client_admin_1@test.com  -> CLIENT_ADMIN_ID (client_admin, Client 1)
--   portal_admin@test.com    -> PORTAL_ADMIN_ID (portal_admin, global)
--   buyer_c@test.com         -> BUYER_C_ID      (buyer, Store C, Client 2 -- isolation check)

-- ============================================================
-- Clients
-- ============================================================
insert into clients (id, name, cin7_customer_id) values
  ('44444444-4444-4444-4444-444444444444', 'Test Client Co', 'CIN7-CUST-TEST-1'),
  ('55555555-5555-5555-5555-555555555555', 'Second Client Co', 'CIN7-CUST-TEST-2');

-- ============================================================
-- Stores
-- Store A + Store B both belong to Client 1 (proves client_admin
-- can span multiple stores of their own client).
-- Store C belongs to Client 2 (proves isolation from Client 1).
-- ============================================================
insert into stores (id, name, client_id, store_number,
                     cin7_address_line1, cin7_address_city,
                     cin7_address_postcode, cin7_address_country) values
  ('11111111-1111-1111-1111-111111111111', 'Store A - Downtown',
   '44444444-4444-4444-4444-444444444444', '101',
   '1 Test Street', 'Auckland', '1010', 'NZ'),
  ('22222222-2222-2222-2222-222222222222', 'Store B - Uptown',
   '44444444-4444-4444-4444-444444444444', '102',
   '2 Test Street', 'Auckland', '1011', 'NZ'),
  ('66666666-6666-6666-6666-666666666666', 'Store C - Other Client',
   '55555555-5555-5555-5555-555555555555', '201',
   '9 Other Street', 'Wellington', '6011', 'NZ');

-- ============================================================
-- Users (mirrors auth.users)
-- ============================================================
insert into users (id, email, full_name) values
  ('aa7bbe7a-3788-4301-a59e-6d15685f39bf', 'buyer_a@test.com', 'Buyer A'),
  ('4fc2b8d1-7ac5-4440-8f4d-e94091f3b854', 'admin_a@test.com', 'Admin A'),
  ('5e547018-7258-42bb-bfd2-a7b6fe5eb079', 'buyer_b@test.com', 'Buyer B'),
  ('8beb4f07-f590-4986-9b63-192a8c36f1e7', 'client_admin_1@test.com', 'Client Admin 1'),
  ('e0b02aa5-1f1e-441a-b02f-7d39f31ba3b6', 'portal_admin@test.com', 'Portal Admin'),
  ('b3d15c34-08c3-4837-b717-678208f6bdfe', 'buyer_c@test.com', 'Buyer C');

-- Portal admin is a flag on the user, not a role row
update users set is_portal_admin = true where id = 'e0b02aa5-1f1e-441a-b02f-7d39f31ba3b6';

-- ============================================================
-- Store-level role assignments
-- ============================================================
insert into user_store_roles (user_id, store_id, role) values
  ('aa7bbe7a-3788-4301-a59e-6d15685f39bf', '11111111-1111-1111-1111-111111111111', 'buyer'),
  ('4fc2b8d1-7ac5-4440-8f4d-e94091f3b854', '11111111-1111-1111-1111-111111111111', 'store_admin'),
  ('5e547018-7258-42bb-bfd2-a7b6fe5eb079', '22222222-2222-2222-2222-222222222222', 'buyer'),
  ('b3d15c34-08c3-4837-b717-678208f6bdfe', '66666666-6666-6666-6666-666666666666', 'buyer');

-- ============================================================
-- Client-level role assignment
-- Client Admin 1 gets rights across ALL of Client 1's stores
-- (Store A and Store B) without a row in user_store_roles for either.
-- ============================================================
insert into user_client_roles (user_id, client_id, role) values
  ('8beb4f07-f590-4986-9b63-192a8c36f1e7', '44444444-4444-4444-4444-444444444444', 'client_admin');

-- ============================================================
-- Test orders — one per store, so cross-store/cross-client
-- visibility can be checked directly by counting visible orders.
-- ============================================================
insert into orders (id, store_id, requested_by, status) values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111', 'aa7bbe7a-3788-4301-a59e-6d15685f39bf', 'pending_approval'),
  ('77777777-7777-7777-7777-777777777777',
   '22222222-2222-2222-2222-222222222222', '5e547018-7258-42bb-bfd2-a7b6fe5eb079', 'pending_approval'),
  ('88888888-8888-8888-8888-888888888888',
   '66666666-6666-6666-6666-666666666666', 'b3d15c34-08c3-4837-b717-678208f6bdfe', 'pending_approval');

insert into order_lines (order_id, sku, description, quantity, unit_price) values
  ('33333333-3333-3333-3333-333333333333', 'SKU-001', 'Test widget', 5, 12.50),
  ('77777777-7777-7777-7777-777777777777', 'SKU-002', 'Test gadget', 3, 8.00),
  ('88888888-8888-8888-8888-888888888888', 'SKU-003', 'Test gizmo', 10, 4.25);
