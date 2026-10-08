-- 038_single_approval_emails.sql
-- Single-order approvals now create an approval record and a notification
-- email too (previously only bulk approvals did, see 037). Each user can turn
-- these single-order emails off for themselves from Account settings.
--
-- notify_single_approval_emails lives on user_preferences (not users) for the
-- same reason as the other preferences there: it needs the self-service RLS
-- policy and can never hold anything privilege-relevant (see 021). Default on.
-- It only affects single-order approval emails; bulk-approval emails always
-- send.
alter table user_preferences add column notify_single_approval_emails boolean not null default true;

-- 'bulk' = "Confirm N selected", 'single' = one order confirmed on its own.
alter table approval_batches add column kind text not null default 'bulk' check (kind in ('bulk', 'single'));

-- 'skipped' = nobody to email (every recipient had single-order emails off).
alter table approval_batches drop constraint approval_batches_email_status_check;
alter table approval_batches add constraint approval_batches_email_status_check
  check (email_status in ('pending', 'sent', 'failed', 'not_configured', 'skipped'));
