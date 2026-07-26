-- ============================================================================
-- FinAtt — let the CSV import carry an employee code and an intended portal.
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
