-- 027_store_client_address.sql
-- Lets staff/client-admins assign which of a client's synced Cin7
-- addresses (014) a specific store ships to. Cin7 itself has no
-- "store" concept -- addresses live on the customer/client only -- so
-- this mapping is portal-native, confirmed with the client (2026-09-02).
-- NULL means "no assignment -- fall back to the client's default
-- address," same as Cart already shows today.
alter table stores add column client_address_id uuid references client_addresses(id) on delete set null;

comment on column stores.client_address_id is
  'Which of the client''s synced Cin7 addresses (client_addresses) this store ships to. NULL falls back to the client''s default address. Settable by that client''s client-admins or Shonrei staff (backend/src/services/stores.js), same permission shape as store_number.';
