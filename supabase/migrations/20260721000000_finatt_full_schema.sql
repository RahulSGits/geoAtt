-- ============================================================================
-- FinAtt — consolidated schema migration
--
-- Safe to run repeatedly on an existing project. It:
--   1. Fixes the 42P17 "infinite recursion detected in policy for relation
--      profiles" error that made every query fail with HTTP 500.
--   2. Adds sites (geofences), shifts, face enrollment, and the geo/selfie
--      columns the check-in flow needs.
--   3. Adds a trigger that computes worked minutes and the daily status.
--   4. Rebuilds every RLS policy on top of a non-recursive role helper.
--   5. Creates the private `selfies` storage bucket + its policies.
--   6. Seeds a demo site and shift set.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------------
-- 1. Non-recursive role helper
--
-- The original policy was:
--     using ( (select role from public.profiles where id = auth.uid()) = 'hr' )
-- Evaluating that policy on `profiles` re-runs the policy on `profiles`, which
-- re-runs it again — Postgres aborts with 42P17. A SECURITY DEFINER function
-- executes as its owner (the table owner), which bypasses RLS and breaks the
-- cycle. `search_path` is pinned so the definer context can't be hijacked.
-- ---------------------------------------------------------------------------
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role::text from public.profiles where id = auth.uid();
$$;

create or replace function public.is_hr()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role = 'hr'::public.app_role from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Resolve the caller's row in `employees` without tripping RLS on employees.
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.employees where user_id = auth.uid() limit 1;
$$;

revoke all on function public.current_role_name() from public;
revoke all on function public.is_hr() from public;
revoke all on function public.current_employee_id() from public;
grant execute on function public.current_role_name() to authenticated, service_role;
grant execute on function public.is_hr() to authenticated, service_role;
grant execute on function public.current_employee_id() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. New tables: sites (geofences) and shifts
-- ---------------------------------------------------------------------------
-- How a site is worked. Only `office` enforces the geofence: you cannot draw a
-- radius around "home", and requiring one would lock remote staff out entirely.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'site_kind') then
    create type public.site_kind as enum ('office', 'remote', 'hybrid');
  end if;
end $$;

create table if not exists public.sites (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  address text,
  kind public.site_kind not null default 'office',
  -- Nullable: a remote site has no coordinates to check against.
  latitude double precision,
  longitude double precision,
  radius_m integer not null default 150 check (radius_m between 25 and 5000),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Existing installs predate `kind`.
alter table public.sites
  add column if not exists kind public.site_kind not null default 'office';

-- Older installs declared these NOT NULL, which a remote site cannot satisfy.
alter table public.sites alter column latitude  drop not null;
alter table public.sites alter column longitude drop not null;

-- An office needs coordinates; remote and hybrid do not.
alter table public.sites drop constraint if exists sites_office_needs_coords;
alter table public.sites add constraint sites_office_needs_coords check (
  kind <> 'office' or (latitude is not null and longitude is not null)
);

create table if not exists public.shifts (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  start_time time not null,
  end_time time not null,
  -- Minutes of grace after start_time before a check-in counts as late.
  grace_minutes integer not null default 15 check (grace_minutes >= 0),
  -- Presence thresholds that drive the auto-computed daily status.
  full_day_minutes integer not null default 480 check (full_day_minutes > 0),
  half_day_minutes integer not null default 240 check (half_day_minutes > 0),
  -- ISO weekday numbers that this shift runs on (1 = Monday .. 7 = Sunday).
  work_days integer[] not null default '{1,2,3,4,5}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 3. Column additions on existing tables
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists site_id uuid references public.sites(id) on delete set null,
  add column if not exists shift_id uuid references public.shifts(id) on delete set null,
  -- 128-float face-api descriptor captured at enrollment.
  add column if not exists face_descriptor jsonb,
  add column if not exists face_enrolled_at timestamptz;

-- Let HR create an employee row before that person has an account.
--
-- Inviting a user requires the service_role key, which is an operational
-- dependency (and is currently invalid on this project). Making user_id
-- nullable lets HR import a roster immediately; the row is adopted by
-- handle_new_profile() when its owner signs up with the same email.
alter table public.employees alter column user_id drop not null;

-- Emails must be unique to adopt a row unambiguously at signup. Case-insensitive
-- because "A@x.com" and "a@x.com" are the same mailbox.
--
-- Guarded: if the table already holds duplicate emails the index cannot be
-- built, and an unguarded failure would abort the rest of this migration. The
-- duplicates are reported instead so they can be merged by hand.
do $$
begin
  create unique index if not exists employees_email_lower_key
    on public.employees (lower(email));
exception
  when unique_violation or duplicate_table then
    raise warning
      'Skipped employees_email_lower_key: duplicate emails exist. Run: select lower(email), count(*) from public.employees group by 1 having count(*) > 1;';
end $$;

alter table public.attendance
  add column if not exists site_id uuid references public.sites(id) on delete set null,
  add column if not exists check_in_lat double precision,
  add column if not exists check_in_lng double precision,
  add column if not exists check_in_accuracy_m double precision,
  add column if not exists check_out_lat double precision,
  add column if not exists check_out_lng double precision,
  add column if not exists check_in_selfie text,
  add column if not exists face_match_score double precision,
  add column if not exists work_minutes integer not null default 0,
  add column if not exists is_late boolean not null default false,
  -- Set when HR corrects a day by hand; tells the trigger to keep its hands off.
  add column if not exists manual_override boolean not null default false,
  add column if not exists notes text;

alter table public.leaves
  add column if not exists decided_by uuid references public.profiles(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text;

alter table public.announcements
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high'));

-- Helpful indexes for the dashboard queries.
create index if not exists attendance_employee_date_idx on public.attendance (employee_id, date desc);
create index if not exists attendance_date_idx          on public.attendance (date desc);
create index if not exists leaves_employee_idx          on public.leaves (employee_id, start_date desc);
create index if not exists leaves_status_idx            on public.leaves (status);
create index if not exists employees_user_idx           on public.employees (user_id);


-- ---------------------------------------------------------------------------
-- 4. Auto-compute worked minutes, lateness, and daily status
-- ---------------------------------------------------------------------------
create or replace function public.compute_attendance_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s              record;
  minutes_worked integer := 0;
  shift_start    timestamptz;
begin
  select sh.*
    into s
    from public.employees e
    join public.shifts sh on sh.id = e.shift_id
   where e.id = new.employee_id;

  if new.check_in is not null and new.check_out is not null then
    minutes_worked := greatest(0, floor(extract(epoch from (new.check_out - new.check_in)) / 60)::int);
  end if;

  new.work_minutes := minutes_worked;

  -- Lateness is judged against the assigned shift's start time plus grace.
  if new.check_in is not null and s.id is not null then
    shift_start := (new.date + s.start_time) at time zone 'UTC';
    new.is_late := new.check_in > (shift_start + make_interval(mins => s.grace_minutes));
  end if;

  -- An HR correction, or an explicitly-set leave/week-off, always wins over the
  -- automatic rule below.
  if new.manual_override
     or new.status in ('leave'::public.attendance_status, 'off'::public.attendance_status)
  then
    return new;
  end if;

  if new.check_in is null then
    new.status := 'absent'::public.attendance_status;
  elsif new.check_out is null then
    new.status := 'pending'::public.attendance_status;
  elsif minutes_worked >= coalesce(s.full_day_minutes, 480) then
    new.status := 'present'::public.attendance_status;
  elsif minutes_worked >= coalesce(s.half_day_minutes, 240) then
    new.status := 'half'::public.attendance_status;
  else
    new.status := 'absent'::public.attendance_status;
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_compute_status on public.attendance;
create trigger attendance_compute_status
  before insert or update of check_in, check_out on public.attendance
  for each row execute function public.compute_attendance_status();


-- ---------------------------------------------------------------------------
-- 5. Employee-ID generation
--
-- The original trigger used `select count(*) from employees` to build the next
-- employee_id. That collides as soon as any employee row is deleted and races
-- under concurrent inserts. A sequence is monotonic and concurrency-safe.
-- ---------------------------------------------------------------------------
create sequence if not exists public.employee_id_seq start with 1;

-- Advance the sequence past any employee_id already in the table so the first
-- generated id after this migration cannot collide with existing data.
select setval(
  'public.employee_id_seq',
  greatest(
    (select coalesce(max(nullif(regexp_replace(employee_id, '\D', '', 'g'), '')::bigint), 0)
       from public.employees),
    1
  )
);

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  default_site  uuid;
  default_shift uuid;
  adopted       uuid;
begin
  -- HR accounts manage staff; they are not themselves on the roster.
  if new.role = 'hr'::public.app_role then
    return new;
  end if;

  -- If HR already imported this person by email, adopt that row rather than
  -- creating a duplicate. This is what makes the CSV import work without ever
  -- touching the auth admin API.
  update public.employees
     set user_id   = new.id,
         full_name = coalesce(nullif(new.full_name, ''), full_name),
         phone     = coalesce(phone, new.phone),
         status    = 'active'
   where user_id is null
     and lower(email) = lower(new.email)
  returning id into adopted;

  if adopted is not null then
    return new;
  end if;

  select id into default_site  from public.sites  where is_active order by created_at limit 1;
  select id into default_shift from public.shifts where is_active order by created_at limit 1;

  insert into public.employees (
    user_id, employee_id, full_name, email, phone,
    department, designation, joining_date, status, site_id, shift_id
  )
  values (
    new.id,
    'EMP-' || lpad(nextval('public.employee_id_seq')::text, 4, '0'),
    new.full_name,
    new.email,
    new.phone,
    new.department,
    new.designation,
    current_date,
    'active',
    default_site,
    default_shift
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- `on conflict (user_id) do nothing` above needs a unique constraint to target.
create unique index if not exists employees_user_id_key on public.employees (user_id);

drop trigger if exists on_public_profile_created on public.profiles;
create trigger on_public_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- Keep the auth -> profile trigger, but make it idempotent so a re-run or a
-- retried signup can't fail the whole transaction.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (
    id, full_name, email, role, phone, department, designation,
    account_status, password_created
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'employee'::public.app_role),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'department',
    new.raw_user_meta_data->>'designation',
    coalesce(new.raw_user_meta_data->>'account_status', 'pending'),
    coalesce((new.raw_user_meta_data->>'password_created')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 6. Row Level Security — rebuilt without recursion
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.employees     enable row level security;
alter table public.attendance    enable row level security;
alter table public.leaves        enable row level security;
alter table public.announcements enable row level security;
alter table public.sites         enable row level security;
alter table public.shifts        enable row level security;

-- Drop every policy this migration is about to redefine, including the
-- recursive originals.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','employees','attendance','leaves','announcements','sites','shifts')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- PROFILES ------------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_select_hr" on public.profiles
  for select using (public.is_hr());
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_update_hr" on public.profiles
  for update using (public.is_hr()) with check (public.is_hr());

-- EMPLOYEES -----------------------------------------------------------------
create policy "employees_select_own" on public.employees
  for select using (user_id = auth.uid());
create policy "employees_update_own" on public.employees
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "employees_all_hr" on public.employees
  for all using (public.is_hr()) with check (public.is_hr());

-- ATTENDANCE ----------------------------------------------------------------
create policy "attendance_select_own" on public.attendance
  for select using (employee_id = public.current_employee_id());
create policy "attendance_insert_own" on public.attendance
  for insert with check (employee_id = public.current_employee_id());
create policy "attendance_update_own" on public.attendance
  for update using (employee_id = public.current_employee_id())
              with check (employee_id = public.current_employee_id());
create policy "attendance_all_hr" on public.attendance
  for all using (public.is_hr()) with check (public.is_hr());

-- LEAVES --------------------------------------------------------------------
create policy "leaves_select_own" on public.leaves
  for select using (employee_id = public.current_employee_id());
create policy "leaves_insert_own" on public.leaves
  for insert with check (employee_id = public.current_employee_id());
-- An employee may edit a request only while it is still pending; once HR has
-- decided, the row is theirs alone to change.
create policy "leaves_update_own_pending" on public.leaves
  for update using (
    employee_id = public.current_employee_id()
    and status = 'pending'::public.leave_status
  ) with check (employee_id = public.current_employee_id());
create policy "leaves_delete_own_pending" on public.leaves
  for delete using (
    employee_id = public.current_employee_id()
    and status = 'pending'::public.leave_status
  );
create policy "leaves_all_hr" on public.leaves
  for all using (public.is_hr()) with check (public.is_hr());

-- ANNOUNCEMENTS -------------------------------------------------------------
create policy "announcements_select_all" on public.announcements
  for select using (auth.uid() is not null);
create policy "announcements_all_hr" on public.announcements
  for all using (public.is_hr()) with check (public.is_hr());

-- SITES / SHIFTS ------------------------------------------------------------
-- Every signed-in user can read them (the check-in screen needs the geofence
-- and the shift window); only HR can change them.
create policy "sites_select_all" on public.sites
  for select using (auth.uid() is not null);
create policy "sites_all_hr" on public.sites
  for all using (public.is_hr()) with check (public.is_hr());

create policy "shifts_select_all" on public.shifts
  for select using (auth.uid() is not null);
create policy "shifts_all_hr" on public.shifts
  for all using (public.is_hr()) with check (public.is_hr());


-- ---------------------------------------------------------------------------
-- 7. Private storage bucket for check-in selfies
-- ---------------------------------------------------------------------------
-- Wrapped: policies on storage.objects need ownership of that table, which some
-- Supabase plans withhold from the SQL editor role. A permission error here must
-- not roll back the schema work above — check-in selfies are an audit nicety,
-- everything else is load-bearing.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('selfies', 'selfies', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "selfies_insert_own" on storage.objects;
  drop policy if exists "selfies_select_own" on storage.objects;
  drop policy if exists "selfies_select_hr"  on storage.objects;

  -- Objects are keyed as `<auth.uid()>/<date>.jpg`, so the first path segment is
  -- the owner and the check below scopes each user to their own folder.
  create policy "selfies_insert_own" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'selfies' and (storage.foldername(name))[1] = auth.uid()::text);

  create policy "selfies_select_own" on storage.objects
    for select to authenticated
    using (bucket_id = 'selfies' and (storage.foldername(name))[1] = auth.uid()::text);

  create policy "selfies_select_hr" on storage.objects
    for select to authenticated
    using (bucket_id = 'selfies' and public.is_hr());
exception
  when insufficient_privilege then
    raise warning
      'Skipped the selfies storage bucket/policies (insufficient privilege). Create the private bucket "selfies" in the Storage UI instead; attendance still works, selfies just are not stored.';
end $$;


-- ---------------------------------------------------------------------------
-- 8. Demo seed — one site and three shifts, only if empty
-- ---------------------------------------------------------------------------
insert into public.sites (name, address, kind, latitude, longitude, radius_m)
select * from (values
  ('Head Office',   'MG Road, Bengaluru, Karnataka 560001', 'office'::public.site_kind, 12.9756::double precision, 77.6068::double precision, 200),
  ('Work From Home', null,                                  'remote'::public.site_kind, null::double precision,    null::double precision,     150),
  ('Hybrid — Office + Home', 'MG Road, Bengaluru',          'hybrid'::public.site_kind, 12.9756::double precision, 77.6068::double precision, 200)
) as v(name, address, kind, latitude, longitude, radius_m)
where not exists (select 1 from public.sites);

insert into public.shifts (name, start_time, end_time, grace_minutes, full_day_minutes, half_day_minutes, work_days)
select * from (values
  ('General Shift', '09:00'::time, '18:00'::time, 15, 480, 240, '{1,2,3,4,5}'::int[]),
  ('Early Shift',   '06:00'::time, '14:00'::time, 10, 450, 225, '{1,2,3,4,5,6}'::int[]),
  ('Night Shift',   '22:00'::time, '06:00'::time, 15, 450, 225, '{1,2,3,4,5}'::int[])
) as v(name, start_time, end_time, grace_minutes, full_day_minutes, half_day_minutes, work_days)
where not exists (select 1 from public.shifts);

-- Backfill: give every existing employee the default site and shift.
update public.employees e
   set site_id  = coalesce(e.site_id,  (select id from public.sites  order by created_at limit 1)),
       shift_id = coalesce(e.shift_id, (select id from public.shifts order by created_at limit 1))
 where e.site_id is null or e.shift_id is null;
