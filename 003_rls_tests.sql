-- 003_rls_tests.sql (replaces the previous version)
-- Manual RLS verification, runnable directly in the Supabase SQL Editor.
-- Extends the original 5 tests with client_admin / portal_admin coverage.
-- Run each block individually and read the output — step through, don't
-- run all at once silently. Substitute in the real UUIDs from 002_seed.sql
-- before running.

-- ============================================================
-- TEST 1: Buyer A sees only Store A (1 store, 1 order) — unchanged
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"aa7bbe7a-3788-4301-a59e-6d15685f39bf","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  visible_stores int;
  visible_orders int;
begin
  select count(*) into visible_stores from stores;
  select count(*) into visible_orders from orders;

  if visible_stores != 1 then
    raise exception 'FAIL: Buyer A should see exactly 1 store, saw %', visible_stores;
  end if;
  if visible_orders != 1 then
    raise exception 'FAIL: Buyer A should see exactly 1 order, saw %', visible_orders;
  end if;

  raise notice 'PASS: Buyer A sees only Store A''s data';
end $$;

reset role;

-- ============================================================
-- TEST 2: Buyer A CANNOT approve their own order — unchanged
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"aa7bbe7a-3788-4301-a59e-6d15685f39bf","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  update orders set status = 'approved'
    where id = '33333333-3333-3333-3333-333333333333';

  if (select status from orders where id = '33333333-3333-3333-3333-333333333333') = 'approved' then
    raise exception 'FAIL: Buyer A was able to approve their own order';
  else
    raise notice 'PASS: update silently affected 0 rows (RLS blocked it)';
  end if;
end $$;

reset role;

-- ============================================================
-- TEST 3: Admin A (store_admin) CAN approve Store A's order — unchanged
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"4fc2b8d1-7ac5-4440-8f4d-e94091f3b854","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  update orders set status = 'approved', approved_by = '4fc2b8d1-7ac5-4440-8f4d-e94091f3b854'
    where id = '33333333-3333-3333-3333-333333333333';

  if (select status from orders where id = '33333333-3333-3333-3333-333333333333') = 'approved' then
    raise notice 'PASS: Admin A approved the order successfully';
  else
    raise exception 'FAIL: Admin A should have been able to approve this order';
  end if;
end $$;

reset role;

-- ============================================================
-- TEST 4: Buyer B (different store) cannot see Store A's order — unchanged
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"5e547018-7258-42bb-bfd2-a7b6fe5eb079","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  visible_orders int;
begin
  select count(*) into visible_orders
    from orders where id = '33333333-3333-3333-3333-333333333333';

  if visible_orders != 0 then
    raise exception 'FAIL: Buyer B should not see Store A''s order, saw %', visible_orders;
  end if;

  raise notice 'PASS: Buyer B cannot see Store A''s order';
end $$;

reset role;

-- ============================================================
-- TEST 5: Buyer B cannot insert an order for Store A — unchanged
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"5e547018-7258-42bb-bfd2-a7b6fe5eb079","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  begin
    insert into orders (store_id, requested_by, status)
      values ('11111111-1111-1111-1111-111111111111', '5e547018-7258-42bb-bfd2-a7b6fe5eb079', 'draft');
    raise exception 'FAIL: Buyer B was able to insert an order for Store A';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: insert for a foreign store was rejected';
  end;
end $$;

reset role;

-- ============================================================
-- TEST 6 (NEW): Client Admin 1 sees BOTH Store A and Store B
-- (Client 1's stores) — proves client-level access spans stores
-- without a user_store_roles row for either.
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"8beb4f07-f590-4986-9b63-192a8c36f1e7","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  visible_stores int;
  visible_orders int;
begin
  select count(*) into visible_stores from stores;
  select count(*) into visible_orders from orders;

  if visible_stores != 2 then
    raise exception 'FAIL: Client Admin 1 should see exactly 2 stores, saw %', visible_stores;
  end if;
  if visible_orders != 2 then
    raise exception 'FAIL: Client Admin 1 should see exactly 2 orders, saw %', visible_orders;
  end if;

  raise notice 'PASS: Client Admin 1 sees both of Client 1''s stores/orders';
end $$;

reset role;

-- ============================================================
-- TEST 7 (NEW): Client Admin 1 CANNOT see Client 2's store/order
-- (Store C) — same check as Test 6, phrased as an explicit
-- negative to make the isolation boundary unambiguous.
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"8beb4f07-f590-4986-9b63-192a8c36f1e7","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  visible int;
begin
  select count(*) into visible
    from orders where id = '88888888-8888-8888-8888-888888888888';

  if visible != 0 then
    raise exception 'FAIL: Client Admin 1 should not see Client 2''s order, saw %', visible;
  end if;

  raise notice 'PASS: Client Admin 1 cannot see Client 2''s order';
end $$;

reset role;

-- ============================================================
-- TEST 8 (NEW): Client Admin 1 CAN approve Store B's order, despite
-- having no user_store_roles row there — proves client_admin
-- approval rights cascade to every store under their client.
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"8beb4f07-f590-4986-9b63-192a8c36f1e7","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  update orders set status = 'approved', approved_by = '8beb4f07-f590-4986-9b63-192a8c36f1e7'
    where id = '77777777-7777-7777-7777-777777777777';

  if (select status from orders where id = '77777777-7777-7777-7777-777777777777') = 'approved' then
    raise notice 'PASS: Client Admin 1 approved Store B''s order';
  else
    raise exception 'FAIL: Client Admin 1 should have been able to approve Store B''s order';
  end if;
end $$;

reset role;

-- ============================================================
-- TEST 9 (NEW): Portal Admin sees everything across both clients
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"e0b02aa5-1f1e-441a-b02f-7d39f31ba3b6","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  visible_stores int;
  visible_orders int;
begin
  select count(*) into visible_stores from stores;
  select count(*) into visible_orders from orders;

  if visible_stores != 3 then
    raise exception 'FAIL: Portal Admin should see all 3 stores, saw %', visible_stores;
  end if;
  if visible_orders != 3 then
    raise exception 'FAIL: Portal Admin should see all 3 orders, saw %', visible_orders;
  end if;

  raise notice 'PASS: Portal Admin sees every store/order across both clients';
end $$;

reset role;

-- ============================================================
-- TEST 10 (NEW): Buyer C (Client 2) cannot see Client 1's stores —
-- reverse-direction isolation check.
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"b3d15c34-08c3-4837-b717-678208f6bdfe","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  visible_stores int;
begin
  select count(*) into visible_stores from stores;

  if visible_stores != 1 then
    raise exception 'FAIL: Buyer C should see exactly 1 store, saw %', visible_stores;
  end if;

  raise notice 'PASS: Buyer C sees only Store C, nothing from Client 1';
end $$;

reset role;
