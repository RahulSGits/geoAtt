-- ============================================================================
-- FinAtt — authorised account deletion.
--
-- Who may delete what:
--
--   Admin  ->  employees, HR accounts, and employee accounts (everything except
--              themselves and the last remaining admin)
--   HR     ->  employees only. Never an HR or admin account, even one that
--              happens to have an employees row.
--
-- Both routes are SECURITY DEFINER functions rather than table grants, for the
-- same reason set_member_role is: the rule then lives in Postgres. A bug in a
-- server action, or a caller reaching the API directly with a stolen anon key,
-- still cannot delete something these functions refuse to delete.
--
-- The password re-authentication the UI asks for is enforced in the server
-- action (Postgres never sees the password). It is a second factor on top of
-- these checks, not a replacement for them.
--
-- Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit trail.
--
--    Written by the definer functions below, which bypass RLS. There is
--    deliberately no insert/update/delete policy: nothing outside those
--    functions can write here, and nothing at all can rewrite history.
-- ---------------------------------------------------------------------------
create table if not exists public.deletion_audit (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid,
  actor_email     text,
  actor_role      text,
  target_kind     text not null check (target_kind in ('employee', 'member')),
  target_id       uuid,
  target_user_id  uuid,
  target_name     text,
  target_email    text,
  target_role     text,
  records_removed jsonb not null default '{}'::jsonb,
  auth_user_state text,
  created_at      timestamptz not null default now()
);

create index if not exists deletion_audit_created_idx
  on public.deletion_audit (created_at desc);

alter table public.deletion_audit enable row level security;

drop policy if exists "deletion_audit_select_admin" on public.deletion_audit;
create policy "deletion_audit_select_admin" on public.deletion_audit
  for select using (public.is_admin());

grant select on public.deletion_audit to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Remove the auth login, if this database is allowed to.
--
--    Deleting auth.users here rather than through GoTrue's admin API is what
--    makes the whole removal one transaction: the login cannot survive a
--    half-failed delete. auth.identities, sessions and refresh_tokens are all
--    ON DELETE CASCADE from auth.users, so they go with it.
--
--    If this deployment does not grant the migration's owner DELETE on
--    auth.users, that is not fatal -- 'no_privilege' is returned and the caller
--    falls back to the service-role admin API.
-- ---------------------------------------------------------------------------
create or replace function public.delete_auth_user(target_user uuid)
returns text
language plpgsql security definer set search_path = auth, public, pg_temp
as $$
begin
  -- Defence in depth. This function runs as the migration owner and deletes
  -- logins, so it must refuse an unprivileged caller even if a grant leaks --
  -- and on Supabase grants DO leak: see the revoke note below.
  if not public.is_hr() then
    raise exception 'This action requires the HR or admin role.';
  end if;

  if target_user is null then
    return 'none';
  end if;

  delete from auth.users where id = target_user;
  if not found then
    -- Already gone. The 404 in the logs was exactly this, and it is not a fault.
    return 'absent';
  end if;
  return 'deleted';

exception
  when insufficient_privilege then
    return 'no_privilege';
  when others then
    raise warning 'delete_auth_user(%): %', target_user, sqlerrm;
    return 'failed';
end;
$$;

-- `from public` alone is NOT enough on Supabase. A stock project ships
--   alter default privileges in schema public grant all on functions
--     to postgres, anon, authenticated, service_role;
-- so every function created here also gets an EXPLICIT grant to anon and
-- authenticated. Revoking from PUBLIC drops only the implicit grant; the
-- explicit ones survive and PostgREST then exposes the function at
--   POST /rest/v1/rpc/delete_auth_user
-- to anyone holding the publishable key. Name the roles.
revoke all on function public.delete_auth_user(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Delete an employee (roster row + attendance + leaves, and their login).
--
--    HR-callable, with one hard limit: the target must not be an HR or admin
--    account. Without that check an HR could delete an administrator simply by
--    going through the roster instead of the members list, which would make the
--    admin-only rule in section 4 decorative.
-- ---------------------------------------------------------------------------
create or replace function public.delete_employee_record(
  target uuid,
  drop_login boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  emp          record;
  target_role  text;
  n_attendance int := 0;
  n_leaves     int := 0;
  auth_state   text := 'kept';
  me           uuid := auth.uid();
begin
  if not public.is_hr() then
    raise exception 'This action requires the HR or admin role.';
  end if;

  select id, user_id, full_name, email, employee_id
    into emp
    from public.employees
   where id = target;

  if not found then
    raise exception 'That employee no longer exists.';
  end if;

  -- Never let anyone delete themselves out of the system.
  if emp.user_id is not null and emp.user_id = me then
    raise exception 'You cannot delete your own account.';
  end if;

  -- An employees row linked to an HR or admin login is off-limits to HR.
  if emp.user_id is not null then
    select role::text into target_role from public.profiles where id = emp.user_id;
    if target_role in ('hr', 'admin') and not public.is_admin() then
      raise exception 'Only an administrator can remove an HR or admin account.';
    end if;
  end if;

  select count(*) into n_attendance from public.attendance where employee_id = target;
  select count(*) into n_leaves     from public.leaves     where employee_id = target;

  -- The login goes FIRST, and its failure is fatal.
  --
  -- Deleting the profile first and the login second looks harmless but is not:
  -- delete_auth_user catches its own exceptions, so a failure there left the
  -- profile deleted and the login alive. getSession() then found no profile and
  -- fell back to the role in user_metadata -- meaning a "deleted" HR kept a
  -- working session AND their HR access. Removing auth.users first makes the
  -- login the thing that cannot survive, and cascades profile -> employees ->
  -- attendance/leaves on its own.
  if not drop_login or emp.user_id is null then
    auth_state := 'none';
  else
    auth_state := public.delete_auth_user(emp.user_id);
    -- 'no_privilege' is the one tolerable failure: the server action finishes
    -- the job over the admin API. Anything else must roll the whole thing back
    -- rather than half-delete someone.
    if auth_state not in ('deleted', 'absent', 'no_privilege') then
      raise exception 'Could not remove the sign-in for %; nothing was deleted.', emp.email;
    end if;
  end if;

  -- Belt and braces: no-ops when the cascade above already removed them, and
  -- the actual delete when there was no login to cascade from.
  -- attendance and leaves are ON DELETE CASCADE from employees.
  delete from public.employees where id = target;
  if drop_login and emp.user_id is not null then
    delete from public.profiles where id = emp.user_id;
  end if;

  insert into public.deletion_audit (
    actor_id, actor_email, actor_role, target_kind, target_id, target_user_id,
    target_name, target_email, target_role, records_removed, auth_user_state
  )
  select
    me,
    (select email from public.profiles where id = me),
    (select role::text from public.profiles where id = me),
    'employee', target, emp.user_id, emp.full_name, emp.email,
    coalesce(target_role, 'employee'),
    jsonb_build_object(
      'attendance', n_attendance,
      'leaves', n_leaves,
      'employee_code', emp.employee_id
    ),
    auth_state;

  return jsonb_build_object(
    'full_name', emp.full_name,
    'user_id', emp.user_id,
    'attendance', n_attendance,
    'leaves', n_leaves,
    'auth_user_state', auth_state
  );
end;
$$;

revoke all on function public.delete_employee_record(uuid, boolean) from public, anon;
grant execute on function public.delete_employee_record(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Delete a member account outright (admin only).
--
--    This is the members-list route: it removes the profile, any roster row
--    hanging off it, and the login. Mirrors set_member_role's guard so the top
--    tier can never be emptied.
-- ---------------------------------------------------------------------------
create or replace function public.delete_member_account(target uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  victim       record;
  admin_count  int;
  emp_id       uuid;
  n_attendance int := 0;
  n_leaves     int := 0;
  auth_state   text;
  me           uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can remove an account.';
  end if;

  if target = me then
    raise exception 'You cannot delete your own account.';
  end if;

  select id, full_name, email, role::text as role
    into victim
    from public.profiles
   where id = target;

  if not found then
    raise exception 'That member no longer exists.';
  end if;

  if victim.role = 'admin' then
    select count(*) into admin_count
      from public.profiles where role = 'admin'::public.app_role;
    if admin_count <= 1 then
      raise exception 'Cannot remove the last administrator. Promote someone else to admin first.';
    end if;
  end if;

  select id into emp_id from public.employees where user_id = target;

  if emp_id is not null then
    select count(*) into n_attendance from public.attendance where employee_id = emp_id;
    select count(*) into n_leaves     from public.leaves     where employee_id = emp_id;
  end if;

  -- Login first, and a failure other than 'no_privilege' aborts the whole
  -- transaction -- see the note in delete_employee_record for why the reverse
  -- order leaves a "deleted" account still able to sign in with its old role.
  auth_state := public.delete_auth_user(target);
  if auth_state not in ('deleted', 'absent', 'none', 'no_privilege') then
    raise exception 'Could not remove the sign-in for %; nothing was deleted.', victim.email;
  end if;

  -- No-ops once the cascade from auth.users has run.
  if emp_id is not null then
    delete from public.employees where id = emp_id;
  end if;
  delete from public.profiles where id = target;

  insert into public.deletion_audit (
    actor_id, actor_email, actor_role, target_kind, target_id, target_user_id,
    target_name, target_email, target_role, records_removed, auth_user_state
  )
  select
    me,
    (select email from public.profiles where id = me),
    (select role::text from public.profiles where id = me),
    'member', target, target, victim.full_name, victim.email, victim.role,
    jsonb_build_object(
      'attendance', n_attendance,
      'leaves', n_leaves,
      'had_employee_row', emp_id is not null
    ),
    auth_state;

  return jsonb_build_object(
    'full_name', victim.full_name,
    'email', victim.email,
    'role', victim.role,
    'attendance', n_attendance,
    'leaves', n_leaves,
    'auth_user_state', auth_state
  );
end;
$$;

revoke all on function public.delete_member_account(uuid) from public;
grant execute on function public.delete_member_account(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What a member delete would destroy, for the confirmation dialog.
-- ---------------------------------------------------------------------------
create or replace function public.member_delete_impact(target uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  emp_id uuid;
  victim record;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can remove an account.';
  end if;

  select full_name, email, role::text as role into victim
    from public.profiles where id = target;
  if not found then
    raise exception 'That member no longer exists.';
  end if;

  select id into emp_id from public.employees where user_id = target;

  return jsonb_build_object(
    'full_name', victim.full_name,
    'email', victim.email,
    'role', victim.role,
    'is_self', target = auth.uid(),
    'has_employee_row', emp_id is not null,
    'attendance', coalesce((select count(*) from public.attendance where employee_id = emp_id), 0),
    'leaves', coalesce((select count(*) from public.leaves where employee_id = emp_id), 0),
    'last_admin', victim.role = 'admin'
      and (select count(*) from public.profiles where role = 'admin'::public.app_role) <= 1
  );
end;
$$;

revoke all on function public.member_delete_impact(uuid) from public;
grant execute on function public.member_delete_impact(uuid) to authenticated;
