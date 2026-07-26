-- ============================================================================
-- FinAtt — close the privilege-escalation holes the deletion work exposed.
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
