-- ============================================================================
-- FinAtt — sign in with an employee ID, and admin-gated password resets
--
-- Run after APPLY_STEP_2.sql. Safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Admin-granted permission to change one's own password.
--
-- Everyone must set a password on first login (password_created = false).
-- After that, changing it again requires an admin to grant permission — which
-- is what `password_reset_allowed` records.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists password_reset_allowed boolean not null default false;

comment on column public.profiles.password_reset_allowed is
  'Admin-granted: lets this user change their own password after the first-login setup.';

-- ---------------------------------------------------------------------------
-- 2. Resolve a login identifier (employee ID or email) to an email address.
--
-- SECURITY DEFINER because the caller is not authenticated yet, so RLS would
-- hide the row. It is deliberately minimal: it returns only an email, takes no
-- password, and the sign-in action treats a miss and a wrong password
-- identically — so it cannot be used to prove whether an ID exists.
-- ---------------------------------------------------------------------------
create or replace function public.email_for_login(identifier text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- Already an email address.
    (select u.email from auth.users u
      where lower(u.email) = lower(trim(identifier)) limit 1),
    -- Otherwise treat it as an employee ID (EMP-0001, case-insensitive).
    (select e.email from public.employees e
      where lower(e.employee_id) = lower(trim(identifier)) limit 1)
  );
$$;

revoke all on function public.email_for_login(text) from public;
-- anon must be able to call it: this runs before the user has a session.
grant execute on function public.email_for_login(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admin grants / revokes the password-reset permission.
-- ---------------------------------------------------------------------------
create or replace function public.set_password_reset_permission(target uuid, allowed boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can grant password resets.';
  end if;

  update public.profiles set password_reset_allowed = allowed where id = target;
  if not found then
    raise exception 'That member no longer exists.';
  end if;
  return allowed;
end;
$$;

revoke all on function public.set_password_reset_permission(uuid, boolean) from public;
grant execute on function public.set_password_reset_permission(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Default password for every employee account: finbud@123
--
-- Their profile keeps password_created = false, so the first sign-in sends them
-- to /set-password to choose their own.
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

update auth.users u
   set encrypted_password = crypt('finbud@123', gen_salt('bf', 10)),
       email_confirmed_at = coalesce(u.email_confirmed_at, now()),
       updated_at = now()
  from public.profiles p
 where p.id = u.id
   and p.role = 'employee'::public.app_role
   and coalesce(p.password_created, false) = false;

select p.email, p.role::text as role, p.password_created, p.password_reset_allowed
  from public.profiles p order by p.role::text, p.email;
