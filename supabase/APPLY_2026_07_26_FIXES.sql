-- ===========================================================================
-- geoAtt — consolidated fixes, 2026-07-26.
-- GENERATED from migrations/ in filename order. Edit those, not this file.
-- Run in: Supabase dashboard -> SQL Editor -> paste -> Run. Idempotent.
--
-- READ THE RESULT GRIDS: part 1's last query must read 'ok' on every row,
-- and both 'UNEXPECTED ...' queries must return ZERO rows.
-- ===========================================================================


-- ###########################################################################
-- ##  SOURCE: migrations/20260734000000_auth_user_repair.sql
-- ###########################################################################

-- ============================================================================
-- geoAtt — permanently repair auth.users rows GoTrue cannot scan.
--
-- Symptom, verbatim from this project's Supabase logs on 2026-07-26:
--
--   500 DELETE /admin/users/<id>  Error finding user: sql: Scan error on column
--                                 index 3, name "confirmation_token": converting
--                                 NULL to string is unsupported
--   500 DELETE /admin/users/<id>  Unexpected failure
--   404 DELETE /admin/users/<id>  User not found
--
-- The log names the column outright: confirmation_token, holding NULL.
--
-- Cause: auth.users has varchar columns GoTrue reads into a plain Go `string`,
-- which cannot hold NULL. Supabase's own signup path writes '' into them. A row
-- inserted by hand-written SQL that omits those columns gets NULL instead, and
-- from then on EVERY GoTrue operation that has to load that row fails while
-- scanning it -- sign-in, admin lookup, and (as above) admin delete. The delete
-- never reaches the "delete" part: it dies in "find".
--
-- The 404 is a different and harmless case: that id is genuinely not in
-- auth.users. Deleting an already-absent user is a no-op, not a fault.
--
-- FIX_LOGIN_500.sql repaired this once, by hand, and only reset passwords for
-- the three demo addresses. This migration does the same repair for EVERY row
-- and then makes the fault unrepeatable with a trigger, so a future hand-written
-- INSERT cannot reintroduce it.
--
-- Idempotent. Only ever replaces NULL -- never overwrites a real value.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Which columns must never be NULL.
--
--    Derived from the table itself rather than hard-coded, so this works across
--    GoTrue versions: the rule is "a text column whose own default is the empty
--    string is a column GoTrue expects to be non-NULL". That deliberately spares
--    email and phone, which default to NULL and are legitimately nullable.
--
--    The explicit list is unioned in as a floor, in case a deployment is missing
--    the defaults too.
-- ---------------------------------------------------------------------------
create or replace function public.auth_scalar_columns()
returns setof text
language sql stable security definer set search_path = auth, pg_temp
as $$
  select column_name::text
    from information_schema.columns
   where table_schema = 'auth'
     and table_name = 'users'
     and data_type in ('character varying', 'text')
     and is_nullable = 'YES'
     and (
       column_default like '''''%'
       or column_name in (
         'confirmation_token',
         'recovery_token',
         'email_change',
         'email_change_token_new',
         'email_change_token_current',
         'phone_change',
         'phone_change_token',
         'reauthentication_token'
       )
     )
$$;

-- Naming anon and authenticated is deliberate: Supabase's default privileges
-- grant EXECUTE on every new public function to both, so `from public` alone
-- would leave this callable over PostgREST. Same for repair_auth_users below.
revoke all on function public.auth_scalar_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Repair every existing row.
-- ---------------------------------------------------------------------------
create or replace function public.repair_auth_users(target uuid default null)
returns integer
language plpgsql security definer set search_path = auth, public, pg_temp
as $$
declare
  col     text;
  fixed   bigint;
  total   integer := 0;
begin
  for col in select * from public.auth_scalar_columns() loop
    execute format(
      'update auth.users set %I = '''' where %I is null and ($1 is null or id = $1)',
      col, col
    ) using target;
    get diagnostics fixed = row_count;
    total := total + fixed;
    if fixed > 0 then
      raise notice 'auth.users.%: repaired % row(s)', col, fixed;
    end if;
  end loop;

  return total;
end;
$$;

revoke all on function public.repair_auth_users(uuid) from public, anon, authenticated;
-- service_role only: this is an operational repair, not a user-facing action.
-- The app calls it with the service key when a GoTrue admin call returns the
-- scan error, then retries the call.
grant execute on function public.repair_auth_users(uuid) to service_role;

select public.repair_auth_users() as null_values_repaired;

-- ---------------------------------------------------------------------------
-- 3. Every email user needs an identity row, or the login grant itself fails.
--    Carried over from FIX_LOGIN_500.sql so one migration leaves auth healthy.
-- ---------------------------------------------------------------------------
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email is not null
  and not exists (
    select 1 from auth.identities i
     where i.user_id = u.id and i.provider = 'email'
  );

-- ---------------------------------------------------------------------------
-- 4. Stop it happening again.
--
--    A BEFORE trigger coerces NULL to '' on the way in, so a hand-written
--    INSERT that omits the token columns -- the exact thing that broke these
--    rows -- now produces a row GoTrue can still read. Costs one field
--    assignment per write and touches nothing that already has a value.
-- ---------------------------------------------------------------------------
-- The four columns below have existed for as long as GoTrue has; the rest
-- arrived in later versions. Assigning a column that does not exist would abort
-- the trigger, so the tail is appended to the function body only when the
-- deployment actually has those columns.
do $$
declare
  extra text;
  body  text := '';
begin
  foreach extra in array array[
    'email_change_token_current',
    'phone_change',
    'phone_change_token',
    'reauthentication_token'
  ] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'auth' and table_name = 'users' and column_name = extra
    ) then
      body := body || format('  new.%I := coalesce(new.%I, '''');%s', extra, extra, E'\n');
    end if;
  end loop;

  execute format($f$
    create or replace function public.auth_user_no_null_scalars()
    returns trigger
    language plpgsql security definer set search_path = auth, public, pg_temp
    as $body$
    begin
      new.confirmation_token     := coalesce(new.confirmation_token, '');
      new.recovery_token         := coalesce(new.recovery_token, '');
      new.email_change           := coalesce(new.email_change, '');
      new.email_change_token_new := coalesce(new.email_change_token_new, '');
    %s
      return new;
    end;
    $body$;
  $f$, body);
end $$;

drop trigger if exists auth_user_no_null_scalars on auth.users;
create trigger auth_user_no_null_scalars
  before insert or update on auth.users
  for each row execute function public.auth_user_no_null_scalars();

-- ---------------------------------------------------------------------------
-- 5. Verify. Every row must read 'ok'.
--
--    A row still reading anything else means step 2 could not reach it -- run
--    this file as the postgres/owner role rather than through PostgREST.
-- ---------------------------------------------------------------------------
select
  u.email,
  case
    when u.confirmation_token is null
      or u.recovery_token is null
      or u.email_change is null
      or u.email_change_token_new is null then 'STILL BROKEN: null tokens'
    when not exists (
      select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
    ) then 'STILL BROKEN: no email identity'
    else 'ok'
  end as gotrue_status
from auth.users u
order by u.email;

-- ###########################################################################
-- ##  SOURCE: migrations/20260735000000_account_deletion.sql
-- ###########################################################################

-- ============================================================================
-- geoAtt — authorised account deletion.
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

-- ###########################################################################
-- ##  SOURCE: migrations/20260736000000_harden_access.sql
-- ###########################################################################

-- ============================================================================
-- geoAtt — close the privilege-escalation holes the deletion work exposed.
--
-- Three findings, all of which make an "admin only" rule elsewhere decorative:
--
--  1. profiles.role is writable by the row's owner (profiles_update_own) and by
--     any HR (profiles_update_hr). So HR — or anyone who can UPDATE their own
--     profile — could simply set role = 'admin' over PostgREST and then pass
--     every is_admin() gate in the app. set_member_role's "only an admin may
--     assign roles" and "the last admin cannot be demoted" were both bypassable
--     by not calling set_member_role at all.
--
--  2. employees_all_hr is `for all`, so HR holds raw DELETE on public.employees.
--     Anyone with the publishable key and an HR session could
--       DELETE /rest/v1/employees?id=eq.<uuid>
--     which skips delete_employee_record entirely — and with it the HR/admin
--     check, the typed-name confirmation, the password step-up and the audit
--     row. attendance and leaves cascade away regardless.
--
--  3. Same for attendance and leaves, which HR could delete wholesale.
--
-- The fix keeps every legitimate HR capability. HR still creates, edits and
-- assigns employees; it just cannot change a role or delete a row outside the
-- audited function.
--
-- Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The role column becomes untouchable except through set_member_role.
--
--    A trigger rather than only a policy: policies are per-table and easy to
--    widen later by accident, whereas this holds no matter which policy, grant
--    or future code path performs the UPDATE. SECURITY DEFINER functions run as
--    the owner, so set_member_role and delete_* keep working.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard_role()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role then
    -- auth.uid() is null for the service key and for internal/definer callers,
    -- which is what lets set_member_role and the seed scripts through.
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Only an administrator can change a role.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.profiles_guard_role();

-- The policies stay exactly as they were, and deliberately so.
--
-- The obvious "belt and braces" version pins the role in WITH CHECK with a
-- subquery like `role = (select role from public.profiles where id = auth.uid())`
-- -- but a policy ON profiles that SELECTs profiles re-enters the same policy
-- and raises `42P17: infinite recursion detected in policy for relation
-- "profiles"`. That is the precise bug the first migration in this project
-- exists to fix, so it must not be reintroduced here.
--
-- The trigger above is the enforcement, and it is the stronger of the two
-- anyway: it is SECURITY DEFINER (no RLS re-entry), and it covers every UPDATE
-- regardless of which policy allowed it.

-- ---------------------------------------------------------------------------
-- 2. Deletion of people-data moves behind the audited functions.
--
--    employees_all_hr is replaced by select/insert/update policies. No delete
--    policy means no direct delete for ANY signed-in role; delete_employee_record
--    and delete_member_account are SECURITY DEFINER and run as the owner, so
--    they bypass RLS and remain the only way through.
-- ---------------------------------------------------------------------------
drop policy if exists "employees_all_hr" on public.employees;

-- Each CREATE is preceded by its own DROP: without them a second run of this
-- file aborts on "policy already exists" and every statement after it is rolled
-- back, silently leaving the hardening half-applied.
drop policy if exists "employees_select_hr" on public.employees;
create policy "employees_select_hr" on public.employees
  for select using (public.is_hr());
drop policy if exists "employees_insert_hr" on public.employees;
create policy "employees_insert_hr" on public.employees
  for insert with check (public.is_hr());
drop policy if exists "employees_update_hr" on public.employees;
create policy "employees_update_hr" on public.employees
  for update using (public.is_hr()) with check (public.is_hr());

-- Table-level grants are the other half: RLS never runs if the role was never
-- granted DELETE in the first place.
revoke delete on public.employees from authenticated;
revoke delete on public.profiles  from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Attendance and leaves: HR corrects them, but wholesale deletion is not a
--    workflow the app has. They still disappear by cascade when an employee is
--    removed through the audited function.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'attendance' and policyname = 'attendance_all_hr'
  ) then
    drop policy "attendance_all_hr" on public.attendance;
    drop policy if exists "attendance_select_hr" on public.attendance;
    drop policy if exists "attendance_insert_hr" on public.attendance;
    drop policy if exists "attendance_update_hr" on public.attendance;
    create policy "attendance_select_hr" on public.attendance for select using (public.is_hr());
    create policy "attendance_insert_hr" on public.attendance for insert with check (public.is_hr());
    create policy "attendance_update_hr" on public.attendance for update
      using (public.is_hr()) with check (public.is_hr());
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'leaves' and policyname = 'leaves_all_hr'
  ) then
    drop policy "leaves_all_hr" on public.leaves;
    drop policy if exists "leaves_select_hr" on public.leaves;
    drop policy if exists "leaves_insert_hr" on public.leaves;
    drop policy if exists "leaves_update_hr" on public.leaves;
    create policy "leaves_select_hr" on public.leaves for select using (public.is_hr());
    create policy "leaves_insert_hr" on public.leaves for insert with check (public.is_hr());
    create policy "leaves_update_hr" on public.leaves for update
      using (public.is_hr()) with check (public.is_hr());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Strip anon/authenticated from every function that is not meant to be
--    called from a browser.
--
--    Supabase ships
--      alter default privileges in schema public
--        grant all on functions to postgres, anon, authenticated, service_role;
--    so `revoke ... from public` leaves the explicit per-role grants in place
--    and PostgREST keeps exposing the function. The roles have to be named.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.delete_auth_user(uuid)',
    'public.repair_auth_users(uuid)',
    'public.auth_scalar_columns()',
    'public.profiles_guard_role()',
    'public.auth_user_no_null_scalars()'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Verify. Read the output rather than assuming.
-- ---------------------------------------------------------------------------

-- Must be empty: no signed-in role may hold DELETE on people-data.
select 'UNEXPECTED DELETE GRANT' as problem, table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('employees', 'profiles')
   and privilege_type = 'DELETE'
   and grantee in ('anon', 'authenticated');

-- Must be empty: none of these may be callable over PostgREST.
select 'UNEXPECTED EXECUTE GRANT' as problem, p.proname, r.rolname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral (select unnest(array['anon','authenticated']) as rolname) r
 where n.nspname = 'public'
   and p.proname in ('delete_auth_user', 'repair_auth_users', 'auth_scalar_columns')
   and has_function_privilege(r.rolname, p.oid, 'EXECUTE');

-- Should list the narrowed policies, with no `ALL` command remaining.
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('employees', 'profiles', 'attendance', 'leaves')
 order by tablename, policyname;

-- ###########################################################################
-- ##  SOURCE: migrations/20260737000000_import_role_and_code.sql
-- ###########################################################################

-- ============================================================================
-- geoAtt — let the CSV import carry an employee code and an intended portal.
--
-- The importer creates roster rows only; the login comes later, from "Send
-- invite" or "Create login". So a Role column in the CSV has nowhere to live at
-- import time -- profiles.role only exists once there is an account.
--
-- intended_role parks that choice on the employees row until the login is
-- created, at which point createEmployeeLogin/sendInvites reads it instead of
-- hardcoding 'employee'.
--
-- It is NOT an access grant on its own. Nothing reads intended_role to decide
-- what someone may do -- is_hr() and is_admin() still read profiles.role, which
-- only set_member_role can change. Writing 'admin' here grants nothing until an
-- account is actually created from it, and the import refuses to write anything
-- but 'employee' unless the caller is an administrator.
--
-- Idempotent.
-- ============================================================================

alter table public.employees
  add column if not exists intended_role text not null default 'employee';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_intended_role_check'
  ) then
    alter table public.employees
      add constraint employees_intended_role_check
      check (intended_role in ('employee', 'hr', 'admin'));
  end if;
end $$;

comment on column public.employees.intended_role is
  'Portal to grant when a login is created for this row. Not an access grant: '
  'authorization always reads profiles.role.';

-- Employee codes must be unique, or two rows can claim EMP-0007 and the code
-- stops identifying anyone. The importer now accepts a code from the file, so
-- this is enforced in the database rather than trusted from the caller.
create unique index if not exists employees_employee_id_key
  on public.employees (upper(employee_id));

select 'intended_role + employee_id uniqueness applied' as status;
