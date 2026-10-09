-- 040_order_status_cancelled.sql
-- New terminal order status 'cancelled': an order that was synced to Cin7 and
-- has since been cancelled/voided there. Set automatically by
-- backend/src/integrations/cin7/cancellationSync.js when Cin7 reports the
-- order's Sale as VOIDED. ('rejected' stays the pre-confirm decline.)
--
-- ALTER TYPE ... ADD VALUE can't be used in the same transaction that adds it,
-- so this file must be run on its own, not wrapped in begin/commit.
alter type order_status add value if not exists 'cancelled';
