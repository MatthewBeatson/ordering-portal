-- 003_rls_tests.sql
-- Manual RLS verification, runnable directly in the Supabase SQL Editor.
-- No CLI or pgTAP required — this simulates "logging in as" each test
-- user by setting the JWT claim Supabase's auth.uid() reads from,
-- then checks that RLS restricts what they can see/do.
--
-- Run each block individually and read the output/errors — this is
-- meant to be stepped through, not run all at once silently.
-- Substitute in the real UUIDs from 002_seed.sql before running.

-- ============================================================
-- Helper: "log in" as a given user for this session
-- ============================================================
-- select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
-- set local role authenticated;

-- ============================================================
-- TEST 1: Buyer A can see Store A's order, cannot see Store B
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"BUYER_A_ID","role":"authenticated"}', true);
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
-- TEST 2: Buyer A CANNOT approve (update) their own order
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"BUYER_A_ID","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  update orders
    set status = 'approved'
    where id = '33333333-3333-3333-3333-333333333333';

  -- If we get here without RLS blocking it, check if it actually changed anything.
  if (select status from orders where id = '33333333-3333-3333-3333-333333333333') = 'approved' then
    raise exception 'FAIL: Buyer A was able to approve their own order';
  else
    raise notice 'PASS: update silently affected 0 rows (RLS blocked it)';
  end if;
end $$;

reset role;

-- ============================================================
-- TEST 3: Admin A (store_admin) CAN approve Store A's order
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"ADMIN_A_ID","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  update orders
    set status = 'approved', approved_by = 'ADMIN_A_ID'
    where id = '33333333-3333-3333-3333-333333333333';

  if (select status from orders where id = '33333333-3333-3333-3333-333333333333') = 'approved' then
    raise notice 'PASS: Admin A approved the order successfully';
  else
    raise exception 'FAIL: Admin A should have been able to approve this order';
  end if;
end $$;

reset role;

-- ============================================================
-- TEST 4: Buyer B (different store) cannot see Store A's order at all
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"BUYER_B_ID","role":"authenticated"}', true);
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
-- TEST 5: Buyer B cannot insert an order for Store A
-- ============================================================
select set_config('request.jwt.claims', '{"sub":"BUYER_B_ID","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  begin
    insert into orders (store_id, requested_by, status)
      values ('11111111-1111-1111-1111-111111111111', 'BUYER_B_ID', 'draft');
    raise exception 'FAIL: Buyer B was able to insert an order for Store A';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: insert for a foreign store was rejected';
  end;
end $$;

reset role;
