-- GeoSelfie Attendance - initial schema
-- Run via: supabase db push  (or paste into the Supabase SQL editor)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------------

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters double precision not null default 150,
  created_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_time time not null,
  end_time time not null,
  min_presence_percent numeric not null default 0.5 check (min_presence_percent between 0 and 1),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles (extends auth.users)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  role text not null default 'employee' check (role in ('employee', 'admin')),
  site_id uuid references public.sites (id) on delete set null,
  shift_id uuid references public.shifts (id) on delete set null,
  photo_url text,
  department text,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'employee')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Attendance sessions (raw check-in / check-out events)
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  check_in_time timestamptz not null default now(),
  check_out_time timestamptz,
  check_in_lat double precision not null,
  check_in_lng double precision not null,
  check_out_lat double precision,
  check_out_lng double precision,
  selfie_url text,
  inside_geofence boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_sessions_employee_date
  on public.attendance_sessions (employee_id, date);

-- ---------------------------------------------------------------------------
-- Attendance days (daily aggregate + final status)
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  total_present_seconds integer not null default 0,
  status text not null default 'pending'
    check (status in ('present', 'absent', 'half_day', 'on_leave', 'pending')),
  updated_at timestamptz not null default now(),
  unique (employee_id, date)
);

-- ---------------------------------------------------------------------------
-- Leave requests
-- ---------------------------------------------------------------------------

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.sites enable row level security;
alter table public.shifts enable row level security;
alter table public.profiles enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_days enable row level security;
alter table public.leave_requests enable row level security;

-- helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- sites / shifts: any signed-in user can read, only admins can write
create policy "sites readable by authenticated" on public.sites
  for select using (auth.role() = 'authenticated');
create policy "sites writable by admin" on public.sites
  for all using (public.is_admin()) with check (public.is_admin());

create policy "shifts readable by authenticated" on public.shifts
  for select using (auth.role() = 'authenticated');
create policy "shifts writable by admin" on public.shifts
  for all using (public.is_admin()) with check (public.is_admin());

-- profiles: self read/update, admin read/update all
create policy "profiles self select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "profiles self update" on public.profiles
  for update using (id = auth.uid() or public.is_admin());
create policy "profiles admin insert" on public.profiles
  for insert with check (public.is_admin());

-- attendance_sessions: employee manages own rows, admin reads all
create policy "sessions self select" on public.attendance_sessions
  for select using (employee_id = auth.uid() or public.is_admin());
create policy "sessions self insert" on public.attendance_sessions
  for insert with check (employee_id = auth.uid());
create policy "sessions self update" on public.attendance_sessions
  for update using (employee_id = auth.uid() or public.is_admin());

-- attendance_days: read-only to clients, only written by service role (edge function)
create policy "days self select" on public.attendance_days
  for select using (employee_id = auth.uid() or public.is_admin());

-- leave_requests: employee creates/reads own, admin reads/updates all
create policy "leave self select" on public.leave_requests
  for select using (employee_id = auth.uid() or public.is_admin());
create policy "leave self insert" on public.leave_requests
  for insert with check (employee_id = auth.uid());
create policy "leave admin update" on public.leave_requests
  for update using (public.is_admin());
