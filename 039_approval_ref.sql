-- 039_approval_ref.sql
-- Human-friendly, auto-generated reference for each approval record
-- (APR-00001, APR-00002, ...), shown on the approval page, history list and in
-- the notification email's subject so two approvals on the same day are
-- distinguishable.
--
-- Postgres sequences never roll back, so gaps are possible if an insert fails
-- after taking a number; numbers are unique and increasing, not guaranteed
-- gapless.
create sequence approval_ref_seq;

alter table approval_batches
  add column ref text unique not null
  default ('APR-' || lpad(nextval('approval_ref_seq')::text, 5, '0'));
