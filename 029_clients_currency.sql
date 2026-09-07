-- Client's own display currency (BACKLOG.md "Currency display" item).
-- Purely a portal-side display concern -- money()/format.ts uses this to
-- pick the right symbol ($ / £) and header suffix ("Price (NZD)"). The
-- authoritative currency conversion actually sent to Cin7 on a Sale is
-- still clients.cin7_currency_rate (015_client_currency_rate.sql),
-- untouched here -- that's a conversion RATE, this is a display CODE.
-- NZD default matches every client except SG - UK, confirmed GBP
-- already via cin7_currency_rate's own 2026-08-12 comment.
alter table clients add column currency text not null default 'NZD';

update clients set currency = 'GBP' where name = 'SG - UK';
