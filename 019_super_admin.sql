-- 019_super_admin.sql
-- Adds a second Shonrei-staff tier above the existing flat
-- users.is_portal_admin flag. is_portal_admin ("admin") keeps every
-- capability it already has (curation, confirm/reject, retry sync,
-- etc.) -- is_super_admin ("super admin") is strictly additive on top:
-- currently the only thing it unlocks is the new Staff screen for
-- granting/revoking is_portal_admin / is_super_admin on other users.
--
-- Deliberately NOT a DB constraint that is_super_admin implies
-- is_portal_admin -- kept as an application-level rule (backend
-- services/staff.js) so this migration stays a simple additive column,
-- matching the pattern of every other role flag/table in this project.

alter table users add column is_super_admin boolean not null default false;

comment on column users.is_super_admin is
  'Elevated Shonrei-staff tier above is_portal_admin. Grants access to the Staff screen for managing other users'' is_portal_admin/is_super_admin flags. Application code (backend/src/services/staff.js) enforces that a user can''t be a super admin without also being a portal admin -- not a DB constraint.';

-- Mirrors the existing is_portal_admin() SQL function -- not used by
-- any RLS policy yet (the Staff screen's reads/writes go through the
-- backend's service_role client, same lockdown pattern as
-- stores/clients management), but kept consistent in case a future
-- policy needs it directly in SQL rather than round-tripping through
-- the backend.
create or replace function is_super_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce((select is_super_admin from users where id = auth.uid()), false);
$$;

-- Bootstrap: Matthew's real Shonrei account (already exists in
-- auth.users -- shared Supabase project, see the daily-report app)
-- gets a portal `users` row for the first time here, as the portal's
-- first (and initially only) super admin. Existing test staff account
-- (portal_admin@test.com) is untouched -- stays a regular admin unless
-- promoted later via the Staff screen.
insert into users (id, email, is_portal_admin, is_super_admin)
values ('3e54764c-4f5e-4563-bea0-811125f21583', 'matthew@shonrei.co.nz', true, true)
on conflict (id) do update set is_portal_admin = true, is_super_admin = true;
