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
