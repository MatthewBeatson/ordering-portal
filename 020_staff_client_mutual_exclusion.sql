-- 020_staff_client_mutual_exclusion.sql
-- Hard guarantee, enforced at the database level (not just application
-- code): a user can never simultaneously be Shonrei staff
-- (is_portal_admin/is_super_admin) and hold any client-side role
-- (user_store_roles or user_client_roles). Two triggers close both
-- directions -- making someone staff while they already have a client
-- role, and giving a client role to someone who's already staff -- so
-- the guarantee holds no matter which table is written first, and
-- regardless of whether the write goes through application code
-- (there is currently no service-layer function that even grants
-- store/client roles -- this trigger pair is the primary enforcement,
-- not just defense-in-depth) or a direct SQL edit.

create or replace function prevent_staff_client_overlap_on_users()
returns trigger
language plpgsql
as $$
begin
  if (new.is_portal_admin or new.is_super_admin) and exists (
    select 1 from user_store_roles where user_id = new.id
    union all
    select 1 from user_client_roles where user_id = new.id
  ) then
    raise exception 'User % already holds a client-side role (store or client) -- cannot also be granted staff (is_portal_admin/is_super_admin) access', new.email
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_staff_client_overlap_on_users on users;
create trigger trg_prevent_staff_client_overlap_on_users
  before insert or update of is_portal_admin, is_super_admin on users
  for each row
  execute function prevent_staff_client_overlap_on_users();

create or replace function prevent_staff_client_overlap_on_roles()
returns trigger
language plpgsql
as $$
declare
  is_staff boolean;
begin
  select (is_portal_admin or is_super_admin) into is_staff from users where id = new.user_id;
  if is_staff then
    raise exception 'This user is Shonrei staff (is_portal_admin/is_super_admin) -- cannot also be granted a client-side role (store or client)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_staff_overlap_on_store_roles on user_store_roles;
create trigger trg_prevent_staff_overlap_on_store_roles
  before insert or update on user_store_roles
  for each row
  execute function prevent_staff_client_overlap_on_roles();

drop trigger if exists trg_prevent_staff_overlap_on_client_roles on user_client_roles;
create trigger trg_prevent_staff_overlap_on_client_roles
  before insert or update on user_client_roles
  for each row
  execute function prevent_staff_client_overlap_on_roles();
