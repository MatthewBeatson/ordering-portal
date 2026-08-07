-- 009_lock_down_order_writes.sql
-- Closes a real RLS gap: the existing INSERT/UPDATE policies on
-- `orders` and `order_lines` restrict WHO can write (store/client
-- access, approval rights) but not WHICH COLUMNS or what business
-- rules apply. A store_admin/client_admin with can_approve() rights
-- could, by calling Supabase directly with their own JWT (bypassing
-- the backend entirely), set flagged_for_review/shipped_*/
-- cancellation_*/status to anything -- clearing their own review
-- hold, marking their own order shipped, approving their own
-- cancellation. Similarly, INSERT had no check on what `status` a new
-- order could be created with, or what quantity/price an order_line
-- could carry.
--
-- The backend (services/orders.js) has never relied on these policies
-- to function -- it always writes via the service_role client, which
-- bypasses RLS regardless. So removing them changes zero behavior for
-- the actual application; it only removes a direct-bypass path that
-- was never supposed to be used, matching the trust-boundary design
-- (Lovable reads directly via RLS, but all writes go through the
-- backend API, which enforces the real business rules: staff-only
-- flag/ship/cancel-resolve, status transition guards, etc).
--
-- order_batches' own insert/update policies are left untouched --
-- that's a separate, not-yet-built feature (quick-order batches) with
-- its own self-contained ownership model (created_by = auth.uid()),
-- not part of the orders approval/sync workflow this migration is
-- about.

drop policy "insert orders for own store" on orders;
drop policy "update orders: approvers only, accessible store" on orders;
drop policy "insert order lines via parent order access" on order_lines;

-- No replacement policies are added -- with RLS enabled and no
-- INSERT/UPDATE policy, Postgres denies those operations entirely for
-- the authenticated/anon roles. SELECT policies are untouched; reads
-- via RLS remain the intended pattern for the frontend.
