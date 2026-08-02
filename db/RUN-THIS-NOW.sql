-- ============================================================================
-- geoAtt 0014 — reconcile the schema with the shipped frontend
--
-- WHY THIS EXISTS
--
-- 0002 and 0004 split identity from employment: full_name, email, phone and
-- profile_image moved to profiles, department became a foreign key, and face
-- descriptors moved to their own table. That normalisation is right on its
-- own terms — see docs/01-analysis.md §2.1 — but it was designed ahead of the
-- frontend rewrite, and the frontend has not been rewritten yet.
--
-- The shipped app queries `employees.full_name` directly, so applying 0001–0013
-- to a live project produced:
--
--   Data could not be loaded: column employees_1.full_name does not exist
--
-- Rewriting ~18,000 lines of frontend to match is Phase 5, not a hotfix. This
-- migration restores the column set the running code expects.
--
-- WHAT IS KEPT FROM THE NORMALISATION
--
-- The duplication comes back, but the defect does not. The original complaint
-- was never "these columns exist twice" — it was that *nothing kept them in
-- sync*, so a phone number updated in one table silently went stale in the
-- other. Here profiles is the single writer and triggers propagate to
-- employees, so the two cannot diverge no matter which code path writes.
--
-- departments, face_templates, the views, the audit log and every RLS policy
-- from 0001–0013 stay exactly as they are.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — columns the frontend reads that 0002 renamed or dropped.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists department text,
  add column if not exists designation text,
  -- 0002 called this avatar_path. The frontend says profile_image.
  add column if not exists profile_image text,
  -- 0002 modelled this as is_active boolean; the frontend expects free text
  -- ('pending' | 'active' | ...), and the members list renders it verbatim.
  add column if not exists account_status text default 'active';

-- Carry over anything already written under the old names.
update public.profiles
   set profile_image = coalesce(profile_image, avatar_path)
 where avatar_path is not null and profile_image is null;

update public.profiles
   set account_status = coalesce(account_status, case when is_active then 'active' else 'suspended' end)
 where account_status is null;

-- ---------------------------------------------------------------------------
-- 2. employees — the column set the frontend selects with `select('*')`.
-- ---------------------------------------------------------------------------

-- Drop the dependent view FIRST. Postgres refuses to change the type of a
-- column a view selects:
--
--   0A000: cannot alter type of a column used by a view or rule
--   DETAIL: rule _RETURN on view v_employee_directory depends on column "status"
--
-- It is rebuilt in section 5 against the final column names, so this is a
-- reorder rather than a loss.
drop view if exists public.v_employee_directory;

-- The frontend calls the human-facing code `employee_id`. 0004 named it
-- employee_code. Rename rather than duplicate: two columns holding the same
-- code is exactly the drift this migration exists to avoid.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees'
                and column_name = 'employee_code')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees'
                and column_name = 'employee_id') then
    alter table public.employees rename column employee_code to employee_id;
  end if;
end $$;

alter table public.employees
  -- Mirrored from profiles by the trigger below. Never written directly.
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists profile_image text,
  -- Denormalised from departments.name, kept in step by the same trigger, so
  -- the roster can be read without a join.
  add column if not exists department text,
  -- Dropped by 0004; the employee profile form still edits both.
  add column if not exists gender text,
  add column if not exists address text;

-- status stays the employment_status enum from 0004, deliberately.
--
-- The first version of this widened it to text so a CSV import could not fail
-- on an unexpected word. Postgres refused:
--
--   0A000: cannot alter type of a column used by a view or rule
--
-- because four views select it — v_employee_directory, v_department_headcount,
-- v_leave_queue and v_today_summary. Changing the type means dropping and
-- rebuilding all four, which is a lot of moving parts for a convenience.
--
-- It is also the wrong trade. PostgREST returns an enum as a plain string, so
-- `status === 'active'` and writing 'active' both work unchanged — the
-- frontend cannot tell the difference. What the enum adds is rejecting a
-- typo'd status outright instead of storing it, which is worth more than
-- tolerating one. If an import ever does need a new value, add it to the enum
-- rather than widening the column.

-- ---------------------------------------------------------------------------
-- 3. Face descriptors, back on the employee row.
--
-- This is the one place the normalisation is genuinely given up rather than
-- preserved behind a trigger, so it is worth being explicit about the cost.
--
-- docs/01-analysis.md §2.2 measured the problem: the descriptor is ~10 kB of
-- JSON per employee, the HR dashboard does `select('*')` with no limit, and at
-- 600 employees that is ~6 MB of face vectors on every load, for data the page
-- never renders.
--
-- Reading it from face_templates instead requires changing the enrollment and
-- check-in code, which is Phase 5. Until then correctness beats payload: the
-- column comes back so the app runs. face_templates is left in place, unused,
-- ready for that change.
--
-- The fix when it comes is one line in hr/page.tsx — naming columns instead of
-- `select('*')` — not another migration.
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists face_descriptor jsonb,
  add column if not exists face_enrolled_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. Keep the mirrored columns honest.
--
-- profiles is the writer; employees follows. Both directions are covered:
-- a profile edit fans out to its employee row, and a new or re-pointed
-- employee row pulls the current values in.
-- ---------------------------------------------------------------------------
create or replace function public.sync_employee_identity()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  update public.employees e
     set full_name     = new.full_name,
         email         = new.email::text,
         phone         = new.phone,
         profile_image = new.profile_image
   where e.user_id = new.id;
  return new;
end;
$$;

drop trigger if exists profiles_sync_employee on public.profiles;
create trigger profiles_sync_employee
  after update of full_name, email, phone, profile_image on public.profiles
  for each row execute function public.sync_employee_identity();

/**
 * Fill the mirrored columns on the employee row itself.
 *
 * BEFORE, not AFTER: assigning to NEW is how a before-trigger writes, and it
 * avoids the recursive UPDATE an after-trigger would need.
 */
create or replace function public.fill_employee_identity()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  p record;
begin
  if new.user_id is not null then
    select full_name, email, phone, profile_image into p
      from public.profiles where id = new.user_id;
    if found then
      new.full_name     := coalesce(new.full_name, p.full_name);
      new.email         := coalesce(new.email, p.email::text);
      new.phone         := coalesce(new.phone, p.phone);
      new.profile_image := coalesce(new.profile_image, p.profile_image);
    end if;
  end if;

  if new.department_id is not null then
    select name into new.department from public.departments where id = new.department_id;
  end if;

  return new;
end;
$$;

drop trigger if exists employees_fill_identity on public.employees;
create trigger employees_fill_identity
  before insert or update of user_id, department_id on public.employees
  for each row execute function public.fill_employee_identity();

-- Backfill anything created before these triggers existed.
update public.employees e
   set full_name     = coalesce(e.full_name, p.full_name),
       email         = coalesce(e.email, p.email::text),
       phone         = coalesce(e.phone, p.phone),
       profile_image = coalesce(e.profile_image, p.profile_image)
  from public.profiles p
 where p.id = e.user_id;

update public.employees e
   set department = d.name
  from public.departments d
 where d.id = e.department_id and e.department is distinct from d.name;

-- ---------------------------------------------------------------------------
-- 5. The directory view has to follow the rename.
-- ---------------------------------------------------------------------------
drop view if exists public.v_employee_directory;
create view public.v_employee_directory
with (security_invoker = on) as
select
  e.id,
  e.employee_id,
  e.user_id,
  e.full_name,
  e.email,
  e.phone,
  e.profile_image,
  p.role,
  e.department,
  e.department_id,
  e.designation,
  e.joining_date,
  e.status,
  e.site_id,
  s.name  as site_name,
  e.shift_id,
  sh.name as shift_name,
  e.reward_points,
  (e.face_descriptor is not null) as face_enrolled,
  e.created_at
from public.employees e
left join public.profiles    p  on p.id  = e.user_id
left join public.sites       s  on s.id  = e.site_id
left join public.shifts      sh on sh.id = e.shift_id;

-- ---------------------------------------------------------------------------
-- 6. Index the columns the roster actually filters on.
-- ---------------------------------------------------------------------------
create unique index if not exists employees_employee_id_key
  on public.employees (upper(employee_id));

create index if not exists employees_department_text_idx
  on public.employees (department);

create index if not exists employees_email_idx
  on public.employees (lower(email));
