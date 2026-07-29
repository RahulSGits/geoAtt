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
