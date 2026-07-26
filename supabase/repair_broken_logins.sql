-- ============================================================================
-- Repair accounts that cannot sign in with
--   500  unexpected_failure  "Database error querying schema"
--
-- Cause: the account was inserted straight into auth.users (the old
-- fix_database_and_seed.sql did exactly this) without a matching row in
-- auth.identities. GoTrue joins identities during the password grant, so the
-- lookup errors out — the account exists but every sign-in attempt 500s.
--
-- That is why employee@demo.com fails while hr@demo.com works: the latter was
-- created through the normal signup flow, which writes both rows.
--
-- Run this AFTER the schema migration. Safe to run repeatedly — every step
-- only fills in what is missing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The actual fix: give every identity-less email user the row GoTrue wants.
-- ---------------------------------------------------------------------------
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(), now(), now()
from auth.users u
where u.email is not null
  and not exists (
    select 1 from auth.identities i
     where i.user_id = u.id and i.provider = 'email'
  );

-- ---------------------------------------------------------------------------
-- 2. This project requires email confirmation, which a raw INSERT skips.
--    Confirm only the seeded demo accounts.
-- ---------------------------------------------------------------------------
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at = now()
 where email in ('hr@demo.com', 'employee@demo.com')
   and email_confirmed_at is null;

-- ---------------------------------------------------------------------------
-- 3. Backfill profiles for auth users created before the trigger existed.
--    Without this you sign in successfully but land on an empty dashboard.
-- ---------------------------------------------------------------------------
insert into public.profiles (
  id, full_name, email, role, account_status, password_created
)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  u.email,
  coalesce((u.raw_user_meta_data->>'role')::public.app_role, 'employee'::public.app_role),
  'active',
  true
from auth.users u
where u.email is not null
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Backfill employee records for non-HR profiles that have none, attaching
--    the default site and shift so check-in works immediately.
-- ---------------------------------------------------------------------------
insert into public.employees (
  user_id, employee_id, full_name, email, department, designation,
  joining_date, status, site_id, shift_id
)
select
  p.id,
  'EMP-' || lpad(nextval('public.employee_id_seq')::text, 4, '0'),
  p.full_name,
  p.email,
  p.department,
  p.designation,
  current_date,
  'active',
  (select id from public.sites  where is_active order by created_at limit 1),
  (select id from public.shifts where is_active order by created_at limit 1)
from public.profiles p
where p.role <> 'hr'::public.app_role
  and not exists (select 1 from public.employees e where e.user_id = p.id)
  -- Adopt-by-email is handled by the trigger; skip anything already claimed.
  and not exists (select 1 from public.employees e where lower(e.email) = lower(p.email));

-- Link any employee row that was imported by email before its owner signed up.
update public.employees e
   set user_id = p.id
  from public.profiles p
 where e.user_id is null
   and lower(e.email) = lower(p.email);

-- ---------------------------------------------------------------------------
-- 5. Report. Every column below should be true / non-zero for a healthy login.
-- ---------------------------------------------------------------------------
select
  u.email,
  (u.email_confirmed_at is not null)                          as email_confirmed,
  (select count(*) from auth.identities i
    where i.user_id = u.id and i.provider = 'email')          as email_identities,
  p.role,
  p.password_created,
  (select count(*) from public.employees e where e.user_id = u.id) as employee_rows
from auth.users u
left join public.profiles p on p.id = u.id
order by u.email;
