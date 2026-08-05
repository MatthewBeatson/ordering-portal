-- 005_client_tax.sql
-- Adds per-client tax configuration, needed by the Cin7 sync module
-- (Phase 4). Different clients are taxed differently (e.g. one is tax
-- exempt, one is NZ GST-registered at 15%, a future one is UK VAT at
-- 20%), so this can't be a single constant anywhere in code -- it has
-- to live on the client record.
--
-- order_lines has no tax data of its own (just sku/quantity/unit_price),
-- so the sync module computes Tax/Total per line from this rate at
-- sync time rather than reading it back from Cin7.

alter table clients add column cin7_tax_rule text;
alter table clients add column tax_rate numeric(6, 4) not null default 0;

comment on column clients.cin7_tax_rule is
  'Must exactly match a Tax Rule name configured in this client''s own Cin7 Core account (Settings > Tax Rules). Required before any order for this client can sync to Cin7 -- the sync module fails fast with a clear error if this is null.';

comment on column clients.tax_rate is
  'Decimal tax rate applied to order lines when syncing to Cin7, e.g. 0.15 for 15% GST, 0 for tax exempt. Prices in order_lines are treated as tax-exclusive.';

-- Existing seed clients default to tax_rate = 0 (via column default) and
-- cin7_tax_rule = null. Set the real Tax Rule name for each client (as
-- configured in their own Cin7 account) before syncing real orders --
-- e.g.:
--   update clients set cin7_tax_rule = 'Tax Exempt', tax_rate = 0
--     where id = '44444444-4444-4444-4444-444444444444';
--   update clients set cin7_tax_rule = 'GST', tax_rate = 0.15
--     where id = '55555555-5555-5555-5555-555555555555';
