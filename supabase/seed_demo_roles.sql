-- ============================================================================
-- FinAtt — repair and seed the three demo accounts
--
--   admin@demo.com     / demo1234  -> admin      (full access)
--   hr@demo.com        / demo1234  -> hr         (workforce management)
--   employee@demo.com  / demo1234  -> employee   (their own portal)
--
-- Run AFTER APPLY_STEP_1.sql (the 'admin' role value must already exist).
-- Safe to run repeatedly.
--
-- Fixes every failure mode seen so far:
--   * 400 "Invalid login credentials"  -> resets the password to demo1234
--   * 500 "Database error querying schema" -> creates the missing
--     auth.identities row that the password grant joins against
--   * profiles.email drifting away from auth.users.email, which made one
--     account sign in and render as a different one (the HR login showing the
--     Admin console). Everything below is keyed off auth.users, never off the
--     possibly-wrong profiles.email.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Create any missing demo user. Existing ones keep their id.
-- ---------------------------------------------------------------------------
-- The empty strings are not cosmetic. GoTrue reads these columns into a Go
-- `string`, which cannot hold NULL, so a row that leaves them unset makes
-- every sign-in for that account fail with HTTP 500 "Database error querying
-- schema" regardless of the password.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
  'authenticated', v.email, crypt('demo1234', gen_salt('bf', 10)), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', v.name, 'role', v.role,
                     'account_status', 'active', 'password_created', true),
  now(), now(), false,
  '', '', '', ''
from (values
  ('admin@demo.com',    'admin',    'Admin Demo'),
  ('hr@demo.com',       'hr',       'HR Demo'),
  ('employee@demo.com', 'employee', 'Employee Demo')
) as v(email, role, name)
where not exists (select 1 from auth.users u where lower(u.email) = v.email);

-- ---------------------------------------------------------------------------
-- 2. Reset the password and confirm the address on all three.
-- ---------------------------------------------------------------------------
update auth.users
   set encrypted_password = crypt('demo1234', gen_salt('bf', 10)),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at = now()
 where lower(email) in ('admin@demo.com', 'hr@demo.com', 'employee@demo.com');

-- 2b. Heal rows an earlier version of this script inserted with NULL tokens.
--     See FIX_LOGIN_500.sql for the full explanation.
update auth.users
   set confirmation_token = coalesce(confirmation_token, ''),
       recovery_token = coalesce(recovery_token, ''),
       email_change = coalesce(email_change, ''),
       email_change_token_new = coalesce(email_change_token_new, '')
 where confirmation_token is null
    or recovery_token is null
    or email_change is null
    or email_change_token_new is null;

-- ---------------------------------------------------------------------------
-- 3. Every email user needs an identity, or the grant fails with a 500.
-- ---------------------------------------------------------------------------
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email is not null
  and not exists (
    select 1 from auth.identities i
     where i.user_id = u.id and i.provider = 'email'
  );

-- ---------------------------------------------------------------------------
-- 4. Repair drift: a profile's email must always mirror its auth user's.
--    This is what un-crosses the wired-up accounts.
-- ---------------------------------------------------------------------------
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and lower(coalesce(p.email, '')) is distinct from lower(u.email);

-- ---------------------------------------------------------------------------
-- 5. Create any missing profile.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, full_name, email, role, account_status, password_created)
select u.id, initcap(split_part(u.email, '@', 1)), u.email,
       'employee'::public.app_role, 'active', true
from auth.users u
where lower(u.email) in ('admin@demo.com', 'hr@demo.com', 'employee@demo.com')
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Assign the roles — keyed off auth.users.email, the source of truth.
-- ---------------------------------------------------------------------------
update public.profiles p
   set role = v.role::public.app_role,
       full_name = v.name,
       account_status = 'active',
       password_created = true
  from auth.users u,
       (values
         ('admin@demo.com',    'admin',    'Admin Demo'),
         ('hr@demo.com',       'hr',       'HR Demo'),
         ('employee@demo.com', 'employee', 'Employee Demo')
       ) as v(email, role, name)
 where u.id = p.id
   and lower(u.email) = v.email;

-- ---------------------------------------------------------------------------
-- 7. Only the employee belongs on the roster; admin and HR manage staff.
-- ---------------------------------------------------------------------------
delete from public.employees e
 using public.profiles p
 where e.user_id = p.id
   and p.role in ('admin'::public.app_role, 'hr'::public.app_role);

insert into public.employees (
  user_id, employee_id, full_name, email, joining_date, status, site_id, shift_id
)
select
  p.id,
  'EMP-' || lpad((coalesce(
    (select max(nullif(regexp_replace(employee_id, '\D', '', 'g'), '')::bigint)
       from public.employees), 0) + 1)::text, 4, '0'),
  p.full_name, p.email, current_date, 'active',
  (select id from public.sites  where is_active order by created_at limit 1),
  (select id from public.shifts where is_active order by created_at limit 1)
from public.profiles p
where p.role = 'employee'::public.app_role
  and not exists (select 1 from public.employees e where e.user_id = p.id);

-- Adopt any roster row imported by email before its owner signed up.
update public.employees e
   set user_id = p.id
  from public.profiles p
 where e.user_id is null and lower(e.email) = lower(p.email);

-- ---------------------------------------------------------------------------
-- 8. Report. All three should read: confirmed = true, identities = 1, and the
--    role you expect. profile_email must equal auth_email.
-- ---------------------------------------------------------------------------
select
  u.email                                                        as auth_email,
  p.email                                                        as profile_email,
  p.role::text                                                   as role,
  (u.email_confirmed_at is not null)                             as confirmed,
  (select count(*) from auth.identities i
    where i.user_id = u.id and i.provider = 'email')             as identities,
  (select count(*) from public.employees e where e.user_id = u.id) as employee_rows
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) in ('admin@demo.com', 'hr@demo.com', 'employee@demo.com')
order by u.email;
