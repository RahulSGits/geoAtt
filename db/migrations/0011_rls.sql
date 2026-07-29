-- ============================================================================
-- geoAtt 0011 — Row Level Security
--
-- READ THIS BEFORE EDITING ANY POLICY BELOW.
--
-- The predicate helpers are SECURITY DEFINER for one specific reason. A policy
-- ON profiles that SELECTs profiles re-enters its own policy and raises
--
--   42P17: infinite recursion detected in policy for relation "profiles"
--
-- In the old project that bug made *every* query return HTTP 500 and every
-- dashboard show zeros behind a red banner, and the first migration existed
-- solely to undo it. A SECURITY DEFINER function does not re-enter RLS, which
-- is what breaks the cycle.
--
-- So: never inline `(select role from public.profiles where id = auth.uid())`
-- into a policy on profiles. Call current_role_name() / is_hr() / is_admin().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Predicate helpers.
-- ---------------------------------------------------------------------------
create or replace function public.current_role_name()
returns text
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select role::text from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select role = 'admin'::public.app_role from public.profiles where id = auth.uid()),
    false);
$$;

-- Admin is a superset of HR. The application's roleSatisfies() mirrors this;
-- the two must not drift.
create or replace function public.is_hr()
returns boolean
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select role in ('hr'::public.app_role, 'admin'::public.app_role)
       from public.profiles where id = auth.uid()),
    false);
$$;

/** The caller's employees row, or null. Employees only. */
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select id from public.employees where user_id = auth.uid() limit 1;
$$;

-- Now that is_admin() exists, attach the role guard written in 0002.
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.profiles_guard_role();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Anything without a policy is then denied by default,
-- which is the behaviour we want for a table someone adds later and forgets.
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.departments    enable row level security;
alter table public.sites          enable row level security;
alter table public.shifts         enable row level security;
alter table public.employees      enable row level security;
alter table public.face_templates enable row level security;
alter table public.attendance     enable row level security;
alter table public.leave_types    enable row level security;
alter table public.leaves         enable row level security;
alter table public.announcements  enable row level security;
alter table public.notifications  enable row level security;
alter table public.reward_events  enable row level security;
alter table public.audit_log      enable row level security;

-- ── profiles ───────────────────────────────────────────────────────────────
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.is_hr());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- No delete policy for anyone. Removing a person goes through the audited
-- SECURITY DEFINER function in 0012, which is the only path that also records
-- who did it and why.

-- ── departments, sites, shifts, leave_types ────────────────────────────────
-- Every signed-in user reads these: the check-in screen needs the geofence and
-- the rota, and the leave form needs the types. Only HR writes.
do $$
declare t text;
begin
  foreach t in array array['departments', 'sites', 'shifts', 'leave_types'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists %I_write_hr on public.%I', t, t);
    execute format('create policy %I_write_hr on public.%I for all using (public.is_hr()) with check (public.is_hr())', t, t);
  end loop;
end $$;

-- ── employees ──────────────────────────────────────────────────────────────
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select using (user_id = auth.uid() or public.is_hr());

-- An employee may not move themselves to another site or shift: that is HR's
-- assignment to make, and self-service would waive the geofence they were
-- posted to. Enforced by the column guard trigger below, because RLS cannot
-- express "these columns may not change".
drop policy if exists employees_update_self on public.employees;
create policy employees_update_self on public.employees
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists employees_hr_write on public.employees;
create policy employees_hr_write on public.employees
  for all using (public.is_hr()) with check (public.is_hr());

create or replace function public.employees_guard_assignment()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.is_hr() then
    if new.site_id       is distinct from old.site_id
    or new.shift_id      is distinct from old.shift_id
    or new.employee_code is distinct from old.employee_code
    or new.department_id is distinct from old.department_id
    or new.status        is distinct from old.status
    or new.reward_points is distinct from old.reward_points
    or new.face_enroll_attempts is distinct from old.face_enroll_attempts then
      raise exception 'Only HR can change assignment, status or reward fields.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_guard_assignment on public.employees;
create trigger employees_guard_assignment
  before update on public.employees
  for each row execute function public.employees_guard_assignment();

-- ── face_templates ─────────────────────────────────────────────────────────
-- An employee may read whether they are enrolled and write their own template
-- during enrolment; HR may read and revoke. Nobody reads anyone else's vector.
drop policy if exists face_templates_own on public.face_templates;
create policy face_templates_own on public.face_templates
  for select using (employee_id = public.current_employee_id() or public.is_hr());

drop policy if exists face_templates_enrol on public.face_templates;
create policy face_templates_enrol on public.face_templates
  for insert with check (employee_id = public.current_employee_id());

drop policy if exists face_templates_hr on public.face_templates;
create policy face_templates_hr on public.face_templates
  for all using (public.is_hr()) with check (public.is_hr());

-- ── attendance ─────────────────────────────────────────────────────────────
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select using (employee_id = public.current_employee_id() or public.is_hr());

drop policy if exists attendance_insert_own on public.attendance;
create policy attendance_insert_own on public.attendance
  for insert with check (
    employee_id = public.current_employee_id() and manual_override = false
  );

drop policy if exists attendance_update_own on public.attendance;
create policy attendance_update_own on public.attendance
  for update using (employee_id = public.current_employee_id())
  with check (employee_id = public.current_employee_id() and manual_override = false);

drop policy if exists attendance_hr on public.attendance;
create policy attendance_hr on public.attendance
  for all using (public.is_hr()) with check (public.is_hr());

-- ── leaves ─────────────────────────────────────────────────────────────────
drop policy if exists leaves_select on public.leaves;
create policy leaves_select on public.leaves
  for select using (employee_id = public.current_employee_id() or public.is_hr());

drop policy if exists leaves_apply on public.leaves;
create policy leaves_apply on public.leaves
  for insert with check (
    employee_id = public.current_employee_id() and status = 'pending'
  );

-- An applicant may withdraw a pending request but must never approve their own.
drop policy if exists leaves_withdraw on public.leaves;
create policy leaves_withdraw on public.leaves
  for delete using (
    employee_id = public.current_employee_id() and status = 'pending'
  );

drop policy if exists leaves_hr on public.leaves;
create policy leaves_hr on public.leaves
  for all using (public.is_hr()) with check (public.is_hr());

-- ── announcements ──────────────────────────────────────────────────────────
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements
  for select using (
    auth.uid() is not null
    and published_at <= now()
    and (expires_at is null or expires_at > now())
  );

drop policy if exists announcements_hr on public.announcements;
create policy announcements_hr on public.announcements
  for all using (public.is_hr()) with check (public.is_hr());

-- ── notifications ──────────────────────────────────────────────────────────
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for select using (recipient_id = auth.uid());

-- Marking your own as read. The application also filters on recipient_id.
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

drop policy if exists notifications_hr_send on public.notifications;
create policy notifications_hr_send on public.notifications
  for insert with check (public.is_hr());

-- ── reward_events ──────────────────────────────────────────────────────────
-- Read your own ledger; only HR (or a definer function) writes. Points are
-- awarded by the system, never claimed by the earner.
drop policy if exists reward_events_own on public.reward_events;
create policy reward_events_own on public.reward_events
  for select using (employee_id = public.current_employee_id() or public.is_hr());

drop policy if exists reward_events_hr on public.reward_events;
create policy reward_events_hr on public.reward_events
  for all using (public.is_hr()) with check (public.is_hr());

-- ── audit_log ──────────────────────────────────────────────────────────────
-- Admin reads. NOBODY writes, updates or deletes through the API: rows arrive
-- only via the SECURITY DEFINER triggers and functions, which is what makes
-- the log append-only in practice as well as in intent.
drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select using (public.is_admin());
