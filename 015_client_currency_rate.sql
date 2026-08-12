-- 015_client_currency_rate.sql
-- Cin7's Sale POST requires CurrencyRate whenever a customer's
-- currency differs from the org's base currency (NZD here, per every
-- other customer being NZD) -- confirmed via Cin7's own Sale POST
-- field docs: "Currency Conversion rate expressed as number of [base]
-- currency units for one Customer currency unit. Default value is 1
-- used in case if not specified." We weren't sending it at all, which
-- is exactly why SG - UK (GBP) failed to sync with "Please specify
-- CurrencyRate."

alter table clients add column cin7_currency_rate numeric(10, 4) not null default 1;

comment on column clients.cin7_currency_rate is
  'Number of org base-currency (NZD) units per 1 unit of this client''s Cin7 customer currency. 1 for same-currency clients (Cin7''s own default). Staff-maintained -- exchange rates drift, this is not fetched live.';

-- SG - UK is on GBP; real-world rate at time of writing (~2026-08-12).
update clients set cin7_currency_rate = 2.2968 where name = 'SG - UK';
