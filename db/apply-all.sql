-- ============================================================================
-- geoAtt — complete schema for a fresh Supabase project, in one file.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. It takes a few seconds. Re-running is safe: every statement is
--   idempotent (create if not exists / create or replace / drop policy if
--   exists), so it can be applied repeatedly while iterating.
--
-- WHAT IT CREATES
--   8 enum types, 13 tables, 5 views, 24 functions, the triggers that own
--   attendance status and the audit trail, every RLS policy, and 4 private
--   storage buckets.
--
-- AFTER RUNNING
--   1. Set the timezone the lateness rule reasons in. Without this it defaults
--      to Asia/Kolkata inside the trigger, but setting it on the database makes
--      it explicit and survives a restore:
--        alter database postgres set app.timezone = 'Asia/Kolkata';
--   2. Promote your first administrator — there is no public sign-up:
--        update public.profiles set role = 'admin' where email = 'you@company.com';
--
-- This is generated. Edit db/migrations/*.sql and re-run:
--   node db/tools/build-apply-all.mjs
-- ============================================================================


-- ==========================================================================
-- FILE: 0001_extensions_and_enums.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0001 — extensions and enums
--
-- Target: the NEW Supabase project. Run in filename order, one file at a time.
-- Every file is idempotent; re-running is safe.
--
-- Run this one on its own and let it COMMIT before 0002. Postgres cannot use a
-- value of an enum in the same transaction that created the enum, and the old
-- project hit exactly that: adding 'admin' and referencing it in one run failed
-- with "unsafe use of new value of enum type".
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid, crypt
create extension if not exists citext;     -- case-insensitive email

-- ---------------------------------------------------------------------------
-- Roles.
--
-- Admin is a superset of HR — see is_hr() in 0011. Employee is exact: an admin
-- has no employees row, which is what makes employee-only actions correctly
-- reject them. That behaviour is load-bearing; do not "fix" it by giving
-- admins an employees row.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('employee', 'hr', 'admin');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Attendance status. Computed by trigger in 0005, never set by a client except
-- through an explicit HR override.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.attendance_status as enum
    ('present', 'absent', 'half', 'late', 'leave', 'pending', 'off');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.leave_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- How a place is worked. `office` is geofenced; `remote` never is; `hybrid`
-- has a location but does not enforce it.
do $$ begin
  create type public.site_kind as enum ('office', 'remote', 'hybrid');
exception when duplicate_object then null; end $$;

-- How a rota is worked, independent of where the site is. A remote shift wins
-- over an office site, so a work-from-home rota attached to head office does
-- not fence people out.
do $$ begin
  create type public.work_mode as enum ('on_site', 'remote', 'hybrid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.priority as enum ('low', 'normal', 'high');
exception when duplicate_object then null; end $$;

-- Re-check-in after checking out, subject to HR approval.
do $$ begin
  create type public.recheckin_status as enum ('none', 'requested', 'approved', 'denied');
exception when duplicate_object then null; end $$;

-- Previously free text on two tables. An enum stops 'active'/'Active'/'ACTIVE'
-- being three states.
do $$ begin
  create type public.employment_status as enum ('active', 'suspended', 'exited');
exception when duplicate_object then null; end $$;

-- ==========================================================================
-- FILE: 0002_identity.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0002 — identity: profiles and departments
--
-- THE CHANGE THAT MATTERS IN THIS FILE
--
-- In the old schema, profiles and employees each carried full_name, email,
-- phone, department, designation and profile_image. Six columns, two homes, no
-- trigger or constraint keeping them in step — so updating a phone number in
-- one table silently left the other stale, and which one a given screen read
-- was arbitrary.
--
-- Ownership is now split by meaning:
--
--   profiles   who someone IS      name, email, phone, avatar, role
--   employees  how they are EMPLOYED  code, department, designation, site, shift
--
-- One column, one home, joined at read time.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- departments — was free text, so 'Ops', 'ops' and 'Operations' were three
-- departments and neither rename nor merge was possible.
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness: the point of the table is that the same
-- department cannot exist twice under different capitalisation.
create unique index if not exists departments_name_key
  on public.departments (lower(name));

create unique index if not exists departments_code_key
  on public.departments (upper(code)) where code is not null;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, identity only.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text not null,
  -- citext so 'A@x.com' and 'a@x.com' cannot both exist. The old schema needed
  -- a lower(email) functional index to get this, and that index failed to
  -- create wherever duplicates already existed.
  email             citext not null unique,
  phone             text,
  avatar_path       text,          -- object path in the private `avatars` bucket
  role              public.app_role not null default 'employee',

  -- First sign-in sends the user to /set-password until this is true.
  password_created  boolean not null default false,
  -- Admin-granted, single use: lets someone change their own password again.
  password_reset_allowed boolean not null default false,

  is_active         boolean not null default true,
  last_login_at     timestamptz,
  login_count       integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.profiles.avatar_path is
  'Object path, not a URL. URLs from a private bucket are signed and expire, so storing one would persist a dead link.';

-- Sign-in activity ordering, for the admin console.
create index if not exists profiles_last_login_idx
  on public.profiles (last_login_at desc nulls last);

create index if not exists profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- updated_at, maintained by the database.
--
-- Application code forgets. A trigger cannot.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Role-escalation guard. Ported unchanged in behaviour from the old schema,
-- where it is the real enforcement.
--
-- It must stay a trigger rather than becoming an RLS WITH CHECK clause. The
-- obvious policy version pins the role with a subquery over profiles — but a
-- policy ON profiles that SELECTs profiles re-enters itself and raises
--   42P17: infinite recursion detected in policy for relation "profiles"
-- which is the single worst bug in the old project's history: every query
-- returned HTTP 500 until a migration undid it.
--
-- SECURITY DEFINER means no RLS re-entry, and being a trigger means it covers
-- every UPDATE regardless of which policy allowed it.
--
-- auth.uid() is null for the service key and for other SECURITY DEFINER
-- callers, which is deliberately what lets set_member_role and the bootstrap
-- scripts through.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard_role()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Only an administrator can change a role.';
    end if;
  end if;
  return new;
end;
$$;

-- The trigger is created in 0011, after is_admin() exists.

-- ==========================================================================
-- FILE: 0003_org.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0003 — organisation: sites and shifts
--
-- Carried over from the old schema essentially unchanged. The geofence model
-- here is correct and hard-won; the only changes are constraints that were
-- previously enforced only in application code.
-- ============================================================================

create table if not exists public.sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  kind        public.site_kind not null default 'office',

  -- Null for a remote site: there is no fixed place to fence.
  latitude    double precision,
  longitude   double precision,
  radius_m    integer not null default 150,

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- An office with no coordinates is unfenceable, so the check-in flow would
  -- silently let anyone in from anywhere. Refuse the row instead.
  constraint sites_office_has_location check (
    kind <> 'office' or (latitude is not null and longitude is not null)
  ),
  constraint sites_radius_sane check (radius_m between 25 and 5000),
  constraint sites_lat_range check (latitude is null or latitude between -90 and 90),
  constraint sites_lng_range check (longitude is null or longitude between -180 and 180)
);

create unique index if not exists sites_name_key on public.sites (lower(name));
create index if not exists sites_active_idx on public.sites (is_active) where is_active;

drop trigger if exists sites_touch on public.sites;
create trigger sites_touch before update on public.sites
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- shifts — the rota, and the thresholds the attendance trigger reads.
-- ---------------------------------------------------------------------------
create table if not exists public.shifts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,

  -- Local time at the site. Stored as `time`, combined with the attendance
  -- date at comparison time.
  start_time        time not null,
  end_time          time not null,

  grace_minutes     integer not null default 15,
  full_day_minutes  integer not null default 480,
  half_day_minutes  integer not null default 240,

  -- ISO weekday numbers, 1 = Monday .. 7 = Sunday.
  work_days         smallint[] not null default '{1,2,3,4,5}',

  work_mode         public.work_mode not null default 'on_site',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint shifts_grace_sane check (grace_minutes between 0 and 240),
  constraint shifts_full_day_sane check (full_day_minutes between 1 and 1440),
  constraint shifts_half_day_sane check (half_day_minutes between 1 and 1440),

  -- Half day must be shorter than a full day, or the status ladder in 0005
  -- can never reach 'present'. The old schema checked each bound separately
  -- and allowed this contradiction.
  constraint shifts_half_below_full check (half_day_minutes < full_day_minutes)
);

create unique index if not exists shifts_name_key on public.shifts (lower(name));
create index if not exists shifts_active_idx on public.shifts (is_active) where is_active;

-- Reject a work_days array containing anything that is not an ISO weekday.
create or replace function public.shifts_validate_work_days()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from unnest(new.work_days) d where d < 1 or d > 7) then
    raise exception 'work_days must contain ISO weekday numbers 1..7, got %', new.work_days;
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_check_work_days on public.shifts;
create trigger shifts_check_work_days
  before insert or update of work_days on public.shifts
  for each row execute function public.shifts_validate_work_days();

drop trigger if exists shifts_touch on public.shifts;
create trigger shifts_touch before update on public.shifts
  for each row execute function public.touch_updated_at();

-- ==========================================================================
-- FILE: 0004_employees.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0004 — employees, and face templates as their own table
--
-- THE CHANGE THAT MATTERS IN THIS FILE
--
-- The old schema kept face_descriptor as a jsonb column on employees: 128
-- floats per enrolled pose, up to four poses, roughly 10 kB of JSON per person.
-- The HR dashboard then ran
--
--   supabase.from('employees').select('*')
--
-- with no column list, no limit and no caching. At 600 employees that is on the
-- order of 6 MB of face vectors serialised into every dashboard load, for data
-- the dashboard never renders.
--
-- Templates now live in their own table. The roster query cannot touch them by
-- accident, because they are not there to touch — the fix is structural rather
-- than a discipline that the next `select('*')` would undo.
-- ============================================================================

create table if not exists public.employees (
  id              uuid primary key default gen_random_uuid(),

  -- One employees row per profile. Nullable so HR can prepare a roster before
  -- the accounts exist, which is how CSV import works.
  user_id         uuid unique references public.profiles(id) on delete cascade,

  -- Human-facing code, EMP-0001. Generated by the sequence below.
  employee_code   text not null unique,

  -- Employment facts only. Name, email, phone and avatar live on profiles and
  -- are joined at read time — see 0002.
  department_id   uuid references public.departments(id) on delete set null,
  designation     text,
  joining_date    date,
  exit_date       date,
  status          public.employment_status not null default 'active',

  site_id         uuid references public.sites(id) on delete set null,
  shift_id        uuid references public.shifts(id) on delete set null,

  reward_points   integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint employees_reward_points_non_negative check (reward_points >= 0),
  constraint employees_exit_after_joining check (
    exit_date is null or joining_date is null or exit_date >= joining_date
  )
);

-- The directory filters on both of these on every load, and neither was
-- indexed in the old schema.
create index if not exists employees_status_idx on public.employees (status);
create index if not exists employees_department_idx on public.employees (department_id);
create index if not exists employees_site_idx on public.employees (site_id);
create index if not exists employees_shift_idx on public.employees (shift_id);

drop trigger if exists employees_touch on public.employees;
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Employee code sequence. EMP-0001, EMP-0002, ...
--
-- A sequence rather than max()+1: two concurrent CSV imports both reading the
-- maximum would allocate the same code and one would fail the unique index.
-- ---------------------------------------------------------------------------
create sequence if not exists public.employee_code_seq as bigint start 1;

create or replace function public.next_employee_code()
returns text
language sql
volatile
as $$
  select 'EMP-' || lpad(nextval('public.employee_code_seq')::text, 4, '0');
$$;

-- ---------------------------------------------------------------------------
-- face_templates — one row per enrolled pose.
--
-- Stored as a float array, never as a photograph: the numbers cannot be turned
-- back into an image, so there is no face library to leak. Attendance selfies
-- are separate, live in a private bucket, and are evidence rather than
-- identity.
--
-- One row per pose instead of one jsonb blob means a pose can be re-enrolled
-- or audited on its own, and the descriptor length can actually be constrained.
-- ---------------------------------------------------------------------------
create table if not exists public.face_templates (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,

  -- centre | left | right | up
  pose          text not null,

  -- 128 floats from face-api's faceRecognitionNet. The model is fixed by the
  -- data: descriptors from a different model are not comparable, so changing
  -- it means every employee re-enrols. Recorded here so that is a deliberate
  -- decision rather than a surprise.
  descriptor    double precision[] not null,
  model         text not null default 'face-api/faceRecognitionNet@1',

  enrolled_at   timestamptz not null default now(),

  constraint face_templates_pose_valid check (pose in ('centre', 'left', 'right', 'up')),
  constraint face_templates_descriptor_len check (array_length(descriptor, 1) = 128)
);

-- One template per pose per employee; re-enrolling a pose replaces it.
create unique index if not exists face_templates_employee_pose_key
  on public.face_templates (employee_id, pose);

create index if not exists face_templates_employee_idx
  on public.face_templates (employee_id);

-- ---------------------------------------------------------------------------
-- Enrolment attempts, tracked on the employee.
--
-- Face registration is one-shot by design: the template is the identity anchor
-- for every future check-in, so letting someone silently re-point it at
-- another face would defeat the whole control. A second registration needs an
-- explicit HR grant.
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists face_enroll_attempts integer not null default 0,
  add column if not exists face_enroll_granted_at timestamptz,
  add column if not exists face_enroll_granted_by uuid references public.profiles(id) on delete set null;

alter table public.employees
  drop constraint if exists employees_face_attempts_non_negative;
alter table public.employees
  add constraint employees_face_attempts_non_negative check (face_enroll_attempts >= 0);

-- Convenience: is this employee enrolled at all?
create or replace function public.employee_is_enrolled(target uuid)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.face_templates where employee_id = target);
$$;

-- ==========================================================================
-- FILE: 0005_attendance.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0005 — attendance, and the status trigger
--
-- The status ladder is ported from the old schema with its behaviour intact.
-- It belongs in the database and not in the client: it cannot be spoofed by a
-- forged request, and it cannot drift between the web app, the mobile app and
-- the CSV importer, because there is only one implementation.
-- ============================================================================

create table if not exists public.attendance (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references public.employees(id) on delete cascade,

  date                  date not null,
  check_in              timestamptz,
  check_out             timestamptz,

  status                public.attendance_status not null default 'pending',

  -- How the day was actually worked, chosen at check-in within what the site
  -- and rota allow.
  work_mode             public.work_mode not null default 'on_site',

  site_id               uuid references public.sites(id) on delete set null,

  -- Where the check-in happened. Recorded even when the fence is not enforced,
  -- so HR can see what was claimed.
  check_in_lat          double precision,
  check_in_lng          double precision,
  check_in_accuracy_m   double precision,
  check_out_lat         double precision,
  check_out_lng         double precision,

  -- Object path in the private `attendance-selfies` bucket. Evidence, not
  -- identity — the descriptor in face_templates is the identity anchor.
  check_in_selfie_path  text,
  face_match_distance   double precision,

  work_minutes          integer not null default 0,
  accumulated_minutes   integer not null default 0,
  session_count         integer not null default 1,
  is_late               boolean not null default false,

  -- Re-check-in after checking out, subject to HR approval.
  recheckin_status      public.recheckin_status not null default 'none',
  recheckin_requested_at timestamptz,
  recheckin_note        text,

  -- True when HR set the status by hand. Suppresses the trigger below, which
  -- is the whole point: a correction must not be immediately recomputed away.
  manual_override       boolean not null default false,
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- One row per employee per day. This is what makes a second check-in an
  -- update rather than a duplicate that would double-count worked minutes.
  constraint attendance_employee_date_key unique (employee_id, date),

  constraint attendance_out_after_in check (
    check_out is null or check_in is null or check_out >= check_in
  ),
  constraint attendance_minutes_non_negative check (
    work_minutes >= 0 and accumulated_minutes >= 0
  )
);

create index if not exists attendance_employee_date_idx
  on public.attendance (employee_id, date desc);
create index if not exists attendance_date_idx
  on public.attendance (date desc);
create index if not exists attendance_status_date_idx
  on public.attendance (status, date desc);

-- Partial index: the HR approval queue only ever looks at 'requested', and a
-- full index on a column that is 'none' for ~100% of rows is wasted.
create index if not exists attendance_recheckin_pending_idx
  on public.attendance (recheckin_requested_at desc)
  where recheckin_status = 'requested';

drop trigger if exists attendance_touch on public.attendance;
create trigger attendance_touch before update on public.attendance
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- compute_attendance_status
--
-- Ported from the old schema. Two corrections to the original:
--
--  1. The old version built the shift start as
--       (new.date + s.start_time) at time zone 'UTC'
--     which treats a local rota time as UTC. Anyone not on UTC had lateness
--     computed against the wrong instant — for Finance Buddha in IST that is a
--     5h30m error, so nobody was ever marked late. It now uses the configured
--     app.timezone, defaulting to Asia/Kolkata.
--
--  2. Lateness is only meaningful on a working day. Checking in on a rest day
--     no longer sets is_late.
-- ---------------------------------------------------------------------------
create or replace function public.compute_attendance_status()
returns trigger
language plpgsql
as $$
declare
  s              record;
  minutes_worked integer := 0;
  shift_start    timestamptz;
  tz             text := coalesce(nullif(current_setting('app.timezone', true), ''), 'Asia/Kolkata');
  iso_dow        smallint := extract(isodow from new.date)::smallint;
begin
  select sh.*
    into s
    from public.employees e
    join public.shifts sh on sh.id = e.shift_id
   where e.id = new.employee_id;

  if new.check_in is not null and new.check_out is not null then
    minutes_worked := greatest(
      0, floor(extract(epoch from (new.check_out - new.check_in)) / 60)::int);
  end if;

  -- Minutes banked from earlier completed sessions today, plus this one.
  new.work_minutes := minutes_worked + coalesce(new.accumulated_minutes, 0);

  -- Lateness, against the rota in local time, and only on a working day.
  if new.check_in is not null and s.id is not null
     and iso_dow = any (s.work_days) then
    shift_start := (new.date + s.start_time) at time zone tz;
    new.is_late := new.check_in > (shift_start + make_interval(mins => s.grace_minutes));
  else
    new.is_late := false;
  end if;

  -- An HR correction, or a status the ladder does not own, stands as written.
  if new.manual_override or new.status in ('leave', 'off') then
    return new;
  end if;

  if new.check_in is null then
    new.status := 'absent';
  elsif new.check_out is null then
    new.status := 'pending';
  elsif new.work_minutes >= coalesce(s.full_day_minutes, 480) then
    new.status := 'present';
  elsif new.work_minutes >= coalesce(s.half_day_minutes, 240) then
    new.status := 'half';
  else
    new.status := 'absent';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_compute_status on public.attendance;
create trigger attendance_compute_status
  before insert or update of check_in, check_out, accumulated_minutes, manual_override
  on public.attendance
  for each row execute function public.compute_attendance_status();

comment on function public.compute_attendance_status() is
  'Owns Present/Half/Absent/Pending and lateness. Deferred to by manual_override so an HR correction is not recomputed away.';

-- ==========================================================================
-- FILE: 0006_leaves.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0006 — leave requests
-- ============================================================================

create table if not exists public.leave_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Approving a WFH leave marks the day 'WFH' rather than 'On leave'. The old
  -- schema inferred this by regex-matching the free-text type, which made
  -- "Work From Home (India)" behave differently from "WFH". A flag is explicit.
  is_wfh      boolean not null default false,
  is_paid     boolean not null default true,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists leave_types_name_key on public.leave_types (lower(name));

create table if not exists public.leaves (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id) on delete cascade,
  leave_type_id  uuid not null references public.leave_types(id) on delete restrict,

  start_date     date not null,
  end_date       date not null,
  reason         text,
  status         public.leave_status not null default 'pending',

  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint leaves_end_after_start check (end_date >= start_date),

  -- A decision must record who made it and when. The old schema allowed an
  -- approved row with no decider, which made the audit trail unreliable.
  constraint leaves_decision_complete check (
    status = 'pending' or (decided_by is not null and decided_at is not null)
  )
);

create index if not exists leaves_employee_idx on public.leaves (employee_id, start_date desc);
create index if not exists leaves_status_start_idx on public.leaves (status, start_date);
-- The approval queue only reads pending rows.
create index if not exists leaves_pending_idx on public.leaves (created_at desc)
  where status = 'pending';

-- Overlap detection, enforced rather than merely checked in the UI. Two
-- pending or approved requests for the same employee cannot cover the same day.
create extension if not exists btree_gist;
alter table public.leaves drop constraint if exists leaves_no_overlap;
alter table public.leaves add constraint leaves_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status <> 'rejected');

drop trigger if exists leaves_touch on public.leaves;
create trigger leaves_touch before update on public.leaves
  for each row execute function public.touch_updated_at();

-- ==========================================================================
-- FILE: 0007_comms.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0007 — announcements and notifications
-- ============================================================================

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  priority    public.priority not null default 'normal',
  created_by  uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),

  constraint announcements_expiry_after_publish check (
    expires_at is null or expires_at > published_at
  )
);

create index if not exists announcements_feed_idx
  on public.announcements (published_at desc);

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  -- Scoped to one person. RLS enforces it AND the application filters on it —
  -- defence in depth, so a policy widened later cannot quietly put the whole
  -- company's feed in one person's bell.
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  body          text,
  kind          text not null default 'info',
  link          text,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),

  constraint notifications_kind_valid check (kind in ('info', 'success', 'warning', 'error'))
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

-- The bell badge counts unread only; a partial index keeps that cheap as the
-- table grows.
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id, created_at desc) where read_at is null;

-- Notifications are ephemeral. Without pruning this becomes the largest table
-- in the database and the one nobody reads.
create or replace function public.prune_notifications(older_than interval default '90 days')
returns integer
language sql
security definer set search_path = public, pg_temp
as $$
  with gone as (
    delete from public.notifications
     where created_at < now() - older_than and read_at is not null
    returning 1
  ) select count(*)::int from gone;
$$;

-- ==========================================================================
-- FILE: 0008_rewards.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0008 — punctuality rewards
--
-- reward_events is the ledger; employees.reward_points is the running balance,
-- maintained by trigger so the two cannot disagree. The old schema updated the
-- balance from application code, which meant a failed request could bank points
-- without a matching ledger row.
-- ============================================================================

create table if not exists public.reward_events (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  points       integer not null,
  reason       text not null,
  -- The day earned. Part of the uniqueness rule below.
  date         date not null,
  created_at   timestamptz not null default now(),

  constraint reward_events_points_non_zero check (points <> 0)
);

-- One award per employee per day per reason: re-running a check-in must not
-- pay twice.
create unique index if not exists reward_events_once_per_day
  on public.reward_events (employee_id, date, reason);

create index if not exists reward_events_employee_idx
  on public.reward_events (employee_id, date desc);

create or replace function public.sync_reward_balance()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.employees
       set reward_points = reward_points + new.points
     where id = new.employee_id;
  elsif tg_op = 'DELETE' then
    update public.employees
       set reward_points = greatest(0, reward_points - old.points)
     where id = old.employee_id;
  end if;
  return null;
end;
$$;

drop trigger if exists reward_events_sync on public.reward_events;
create trigger reward_events_sync
  after insert or delete on public.reward_events
  for each row execute function public.sync_reward_balance();

-- ==========================================================================
-- FILE: 0009_audit.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0009 — audit log
--
-- The old schema audited deletions and nothing else. Role changes, attendance
-- overrides, leave decisions and face-enrolment grants are all privileged acts
-- that left no trail — which is precisely the set an auditor asks about.
-- ============================================================================

create table if not exists public.audit_log (
  id           bigserial primary key,
  -- Null when the actor is the service key or a system job, which is itself
  -- worth recording rather than hiding.
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_role   public.app_role,
  action       text not null,
  entity       text not null,
  entity_id    text,
  -- Before/after, so a change can be reconstructed without a second table.
  before       jsonb,
  after        jsonb,
  reason       text,
  ip           inet,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

comment on table public.audit_log is
  'Append-only. No update or delete policy exists in 0011, so rows cannot be edited or removed through the API by any role.';

-- ---------------------------------------------------------------------------
-- Generic recorder, used by the SECURITY DEFINER functions in 0012.
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
  p_action  text,
  p_entity  text,
  p_entity_id text default null,
  p_before  jsonb default null,
  p_after   jsonb default null,
  p_reason  text default null
) returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, before, after, reason)
  values (
    auth.uid(),
    (select role from public.profiles where id = auth.uid()),
    p_action, p_entity, p_entity_id, p_before, p_after, p_reason
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Role changes are audited by trigger rather than by asking callers to
-- remember. A caller that forgets is exactly the case the log is for.
-- ---------------------------------------------------------------------------
create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role then
    insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
    values (
      auth.uid(),
      (select role from public.profiles where id = auth.uid()),
      'role.change', 'profiles', new.id::text,
      jsonb_build_object('role', old.role),
      jsonb_build_object('role', new.role)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_audit_role on public.profiles;
create trigger profiles_audit_role
  after update of role on public.profiles
  for each row execute function public.audit_role_change();

-- Attendance overridden by hand is the other act an auditor will ask about.
create or replace function public.audit_attendance_override()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.manual_override and (
       not old.manual_override
       or new.status is distinct from old.status
       or new.check_in is distinct from old.check_in
       or new.check_out is distinct from old.check_out) then
    insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, before, after, reason)
    values (
      auth.uid(),
      (select role from public.profiles where id = auth.uid()),
      'attendance.override', 'attendance', new.id::text,
      jsonb_build_object('status', old.status, 'check_in', old.check_in, 'check_out', old.check_out),
      jsonb_build_object('status', new.status, 'check_in', new.check_in, 'check_out', new.check_out),
      new.notes
    );
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_audit_override on public.attendance;
create trigger attendance_audit_override
  after update on public.attendance
  for each row execute function public.audit_attendance_override();

-- ==========================================================================
-- FILE: 0010_views.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0010 — read models
--
-- The old system had no views. The HR dashboard fetched whole tables and
-- computed KPIs, the 14-day trend and the status mix in JavaScript — a table
-- scan shipped over the wire to do work Postgres does better. These views are
-- what the dashboard reads instead.
--
-- security_invoker = on is essential: without it a view runs as its owner and
-- silently bypasses RLS, so an employee querying it would see the whole
-- company. With it, the underlying policies still apply.
-- ============================================================================

-- The roster, joined to the names it needs, and deliberately WITHOUT face
-- templates — the whole point of splitting them out in 0004.
create or replace view public.v_employee_directory
with (security_invoker = on) as
select
  e.id,
  e.employee_code,
  e.user_id,
  p.full_name,
  p.email,
  p.phone,
  p.avatar_path,
  p.role,
  d.name          as department,
  e.department_id,
  e.designation,
  e.joining_date,
  e.status,
  e.site_id,
  s.name          as site_name,
  e.shift_id,
  sh.name         as shift_name,
  e.reward_points,
  (select count(*) from public.face_templates ft where ft.employee_id = e.id) > 0
                  as face_enrolled,
  e.created_at
from public.employees e
left join public.profiles    p  on p.id  = e.user_id
left join public.departments d  on d.id  = e.department_id
left join public.sites       s  on s.id  = e.site_id
left join public.shifts      sh on sh.id = e.shift_id;

-- One row per day: the trend chart and the status mix, already reduced.
create or replace view public.v_attendance_daily
with (security_invoker = on) as
select
  a.date,
  count(*)                                          as total,
  count(*) filter (where a.status = 'present')      as present,
  count(*) filter (where a.status = 'half')         as half,
  count(*) filter (where a.status = 'absent')       as absent,
  count(*) filter (where a.status = 'leave')        as on_leave,
  count(*) filter (where a.status = 'pending')      as pending,
  count(*) filter (where a.is_late)                 as late,
  count(*) filter (where a.work_mode = 'remote')    as remote,
  round(avg(a.work_minutes)::numeric, 1)            as avg_work_minutes
from public.attendance a
group by a.date;

create or replace view public.v_department_headcount
with (security_invoker = on) as
select
  d.id   as department_id,
  d.name as department,
  count(e.id) filter (where e.status = 'active') as active_headcount,
  count(e.id)                                    as total_headcount
from public.departments d
left join public.employees e on e.department_id = d.id
group by d.id, d.name;

-- The approval queue, with the applicant already resolved.
create or replace view public.v_leave_queue
with (security_invoker = on) as
select
  l.id,
  l.employee_id,
  e.employee_code,
  p.full_name,
  d.name as department,
  lt.name as leave_type,
  lt.is_wfh,
  l.start_date,
  l.end_date,
  (l.end_date - l.start_date) + 1 as days,
  l.reason,
  l.status,
  l.created_at
from public.leaves l
join public.employees   e  on e.id = l.employee_id
join public.leave_types lt on lt.id = l.leave_type_id
left join public.profiles    p on p.id = e.user_id
left join public.departments d on d.id = e.department_id;

-- Today at a glance, for the dashboard header.
create or replace view public.v_today_summary
with (security_invoker = on) as
select
  (select count(*) from public.employees where status = 'active')          as active_employees,
  (select count(*) from public.attendance
    where date = current_date and check_in is not null)                    as checked_in_today,
  (select count(*) from public.attendance
    where date = current_date and is_late)                                 as late_today,
  (select count(*) from public.leaves where status = 'pending')            as pending_leaves,
  (select count(*) from public.attendance
    where recheckin_status = 'requested')                                  as pending_recheckins;

-- ==========================================================================
-- FILE: 0011_rls.sql
-- ==========================================================================
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

-- ==========================================================================
-- FILE: 0012_rpc.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0012 — RPCs
--
-- Everything here is SECURITY DEFINER, so each function checks authorisation
-- itself as its first act. A definer function that forgets its own check is a
-- complete bypass of RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- set_member_role — the only way a role changes.
--
-- Ported with its most important rule intact: the last administrator cannot be
-- demoted. Enforced here rather than in the UI, because a UI check is advice.
-- ---------------------------------------------------------------------------
create or replace function public.set_member_role(target uuid, new_role public.app_role)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  current_role_of_target public.app_role;
  admin_count integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change a role.';
  end if;

  select role into current_role_of_target from public.profiles where id = target;
  if not found then
    raise exception 'No such member.';
  end if;

  if current_role_of_target = 'admin' and new_role <> 'admin' then
    select count(*) into admin_count from public.profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'Cannot demote the last administrator.';
    end if;
  end if;

  update public.profiles set role = new_role where id = target;
  -- The audit row is written by the trigger in 0009.
end;
$$;

revoke all on function public.set_member_role(uuid, public.app_role) from public;
grant execute on function public.set_member_role(uuid, public.app_role) to authenticated;

-- ---------------------------------------------------------------------------
-- claim_face_enroll_attempt — one-shot enrolment.
--
-- Atomic: the check and the increment happen in one statement, so two requests
-- racing cannot both see "0 used" and both enrol.
-- ---------------------------------------------------------------------------
create or replace function public.claim_face_enroll_attempt(max_attempts integer default 1)
returns boolean
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  me uuid := public.current_employee_id();
  claimed integer;
begin
  if me is null then
    raise exception 'Only an employee can enrol a face.';
  end if;

  update public.employees
     set face_enroll_attempts = face_enroll_attempts + 1
   where id = me and face_enroll_attempts < max_attempts
  returning face_enroll_attempts into claimed;

  return claimed is not null;
end;
$$;

revoke all on function public.claim_face_enroll_attempt(integer) from public;
grant execute on function public.claim_face_enroll_attempt(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- grant_face_reenrolment — HR reopens enrolment for one person.
-- ---------------------------------------------------------------------------
create or replace function public.grant_face_reenrolment(target uuid, reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_hr() then
    raise exception 'Only HR can re-grant face enrolment.';
  end if;

  update public.employees
     set face_enroll_attempts = 0,
         face_enroll_granted_at = now(),
         face_enroll_granted_by = auth.uid()
   where id = target;

  delete from public.face_templates where employee_id = target;

  perform public.write_audit('face.reenrol_granted', 'employees', target::text, null, null, reason);
end;
$$;

revoke all on function public.grant_face_reenrolment(uuid, text) from public;
grant execute on function public.grant_face_reenrolment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- email_for_login — resolve an employee CODE to an email address.
--
-- It deliberately does not handle emails: the caller passes whatever was typed,
-- and a null result means "not a code", so the sign-in path falls through and
-- uses the input as an email directly. That fallthrough is also what makes the
-- next line true.
--
-- SECURITY DEFINER because the caller has no session yet, so RLS would hide the
-- row. Deliberately minimal: it takes no password and returns only an email,
-- and the sign-in path must treat a miss and a wrong password identically so
-- this cannot be used to prove which codes exist.
-- ---------------------------------------------------------------------------
create or replace function public.email_for_login(identifier text)
returns text
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select p.email::text
    from public.employees e
    join public.profiles p on p.id = e.user_id
   where upper(e.employee_code) = upper(trim(identifier))
   limit 1;
$$;

revoke all on function public.email_for_login(text) from public;
grant execute on function public.email_for_login(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_login — sign-in counters for the admin console.
-- ---------------------------------------------------------------------------
create or replace function public.record_login()
returns void
language sql
security definer set search_path = public, pg_temp
as $$
  update public.profiles
     set last_login_at = now(), login_count = login_count + 1
   where id = auth.uid();
$$;

revoke all on function public.record_login() from public;
grant execute on function public.record_login() to authenticated;

-- ---------------------------------------------------------------------------
-- delete_employee_record — the only way a person is removed.
--
-- There is no delete policy on employees for any role (see 0011), so this
-- definer function is the sole path, and it always writes an audit row.
-- ---------------------------------------------------------------------------
create or replace function public.delete_employee_record(target uuid, reason text)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  snapshot jsonb;
begin
  if not public.is_hr() then
    raise exception 'Only HR can remove an employee.';
  end if;
  if reason is null or length(trim(reason)) = 0 then
    raise exception 'A reason is required.';
  end if;

  select to_jsonb(e) into snapshot from public.employees e where e.id = target;
  if snapshot is null then
    raise exception 'No such employee.';
  end if;

  delete from public.employees where id = target;
  perform public.write_audit('employee.delete', 'employees', target::text, snapshot, null, reason);
end;
$$;

revoke all on function public.delete_employee_record(uuid, text) from public;
grant execute on function public.delete_employee_record(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- award_punctuality — called after a successful on-time, on-site check-in.
--
-- The unique index in 0008 makes a repeat award a no-op rather than a second
-- payment, so a retried request cannot pay twice.
-- ---------------------------------------------------------------------------
create or replace function public.award_punctuality(target uuid, on_date date, points integer default 3)
returns boolean
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  insert into public.reward_events (employee_id, points, reason, date)
  values (target, points, 'punctual_checkin', on_date)
  on conflict (employee_id, date, reason) do nothing;
  return found;
end;
$$;

revoke all on function public.award_punctuality(uuid, date, integer) from public;
grant execute on function public.award_punctuality(uuid, date, integer) to authenticated;

-- ==========================================================================
-- FILE: 0013_storage.sql
-- ==========================================================================
-- ============================================================================
-- geoAtt 0013 — storage buckets
--
-- All four are PRIVATE. A public bucket for attendance selfies would put every
-- employee's face on a guessable URL.
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('avatars',            'avatars',            false),
  ('attendance-selfies', 'attendance-selfies', false),
  ('documents',          'documents',          false),
  ('csv-imports',        'csv-imports',        false)
on conflict (id) do update set public = false;

-- Convention: every object is stored under the owning user's UID as the first
-- path segment, e.g. avatars/<uid>/avatar.jpg. The policies below rely on it.
--
-- The shape is validated with a regex rather than by casting inside an
-- exception handler, for two reasons: `language sql` cannot have an EXCEPTION
-- block at all (that is plpgsql only, and the function would fail to create),
-- and a plpgsql handler opens a subtransaction per call — which this cannot
-- afford, because every storage policy below invokes it for every row.
--
-- Returns null for any path that does not start with a UUID segment, and a
-- null owner matches nobody, so a malformed key is denied rather than shared.
create or replace function public.storage_owner_uid(name text)
returns uuid
language sql
immutable
as $$
  select case
    when (string_to_array(name, '/'))[1] ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((string_to_array(name, '/'))[1])::uuid
  end;
$$;

-- ── avatars ────────────────────────────────────────────────────────────────
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (
    bucket_id = 'avatars'
    and (public.storage_owner_uid(name) = auth.uid() or public.is_hr())
  );

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects
  for insert with check (
    bucket_id = 'avatars' and public.storage_owner_uid(name) = auth.uid()
  );

-- WITH CHECK as well as USING: without it an update could rename the object
-- into someone else's prefix, which USING alone would still permit because it
-- only tests the row as it stands before the change.
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars' and public.storage_owner_uid(name) = auth.uid()
  ) with check (
    bucket_id = 'avatars' and public.storage_owner_uid(name) = auth.uid()
  );

-- ── attendance-selfies ─────────────────────────────────────────────────────
-- Readable by their owner and by HR. Never updated or deleted by the employee:
-- a selfie is evidence for a check-in that already happened.
drop policy if exists selfies_read on storage.objects;
create policy selfies_read on storage.objects
  for select using (
    bucket_id = 'attendance-selfies'
    and (public.storage_owner_uid(name) = auth.uid() or public.is_hr())
  );

drop policy if exists selfies_write_own on storage.objects;
create policy selfies_write_own on storage.objects
  for insert with check (
    bucket_id = 'attendance-selfies' and public.storage_owner_uid(name) = auth.uid()
  );

-- ── documents and csv-imports ──────────────────────────────────────────────
drop policy if exists documents_hr on storage.objects;
create policy documents_hr on storage.objects
  for all using (bucket_id = 'documents' and public.is_hr())
  with check (bucket_id = 'documents' and public.is_hr());

drop policy if exists csv_imports_hr on storage.objects;
create policy csv_imports_hr on storage.objects
  for all using (bucket_id = 'csv-imports' and public.is_hr())
  with check (bucket_id = 'csv-imports' and public.is_hr());

-- ==========================================================================
-- FILE: 0014_frontend_compat.sql
-- ==========================================================================
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

-- status: 0004 made this an enum, the frontend treats it as text and the CSV
-- importer can carry values the enum does not know. Widen to text so an import
-- cannot fail on an unexpected word.
do $$ begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'employees'
         and column_name = 'status') = 'USER-DEFINED' then
    alter table public.employees
      alter column status drop default,
      alter column status type text using status::text;
    alter table public.employees alter column status set default 'active';
  end if;
end $$;

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
