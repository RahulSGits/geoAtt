-- ===========================================================================
-- Creates or promotes an administrator.
--
-- Do not run this file directly -- it expects three psql variables that
-- scripts/create-admin.sh supplies over stdin:
--
--   :admin_email     the address to sign in with
--   :admin_password  plain text, used once to compute a bcrypt hash
--   :bcrypt_cost     work factor (12)
--
-- Running it through the script is what keeps the password off the command
-- line and out of any file. Statements are plain SQL rather than DO blocks
-- because psql does not interpolate variables inside dollar-quoted strings.
--
-- Idempotent: run it again to rotate the password of an existing admin.
-- ===========================================================================

create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Create the auth user if this address is new.
--
--    The empty strings matter: GoTrue reads these columns into a Go `string`,
--    which cannot hold NULL, and a row that omits them fails every future
--    sign-in with "Database error querying schema".
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  lower(:'admin_email'),
  crypt(:'admin_password', gen_salt('bf', :bcrypt_cost)),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object(
    'full_name', split_part(:'admin_email', '@', 1),
    'role', 'admin',
    'account_status', 'active',
    'password_created', true
  ),
  now(), now(), false,
  '', '', '', ''
where not exists (
  select 1 from auth.users where lower(email) = lower(:'admin_email')
);

-- ---------------------------------------------------------------------------
-- 2. Set the password, confirm the address, and heal any NULL token columns.
-- ---------------------------------------------------------------------------
update auth.users
   set encrypted_password = crypt(:'admin_password', gen_salt('bf', :bcrypt_cost)),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       confirmation_token = coalesce(confirmation_token, ''),
       recovery_token = coalesce(recovery_token, ''),
       email_change = coalesce(email_change, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       raw_user_meta_data =
         coalesce(raw_user_meta_data, '{}'::jsonb)
         || jsonb_build_object('role', 'admin', 'password_created', true),
       updated_at = now()
 where lower(email) = lower(:'admin_email');

-- ---------------------------------------------------------------------------
-- 3. An email user with no identity row cannot complete the login grant.
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
where lower(u.email) = lower(:'admin_email')
  and not exists (
    select 1 from auth.identities i
     where i.user_id = u.id and i.provider = 'email'
  );

-- ---------------------------------------------------------------------------
-- 4. The profile is what the app reads for the role. password_created = true
--    keeps the account out of the forced /set-password flow, and
--    password_reset_allowed stays false so the self-service change stays shut
--    until an admin deliberately opens it.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, full_name, email, role, account_status, password_created)
select u.id,
       coalesce(nullif(split_part(u.email, '@', 1), ''), 'Administrator'),
       u.email,
       'admin'::public.app_role,
       'active',
       true
from auth.users u
where lower(u.email) = lower(:'admin_email')
on conflict (id) do update
   set role = 'admin'::public.app_role,
       account_status = 'active',
       password_created = true,
       email = excluded.email;

-- Only if the column exists on this deployment (migration 20260732).
update public.profiles p
   set password_reset_allowed = false
  from auth.users u
 where u.id = p.id
   and lower(u.email) = lower(:'admin_email')
   and exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'password_reset_allowed'
   );

-- ---------------------------------------------------------------------------
-- 5. Confirm. Must print exactly one row reading 'ready'.
-- ---------------------------------------------------------------------------
select
  u.email,
  p.role::text as role,
  case
    when u.encrypted_password is null then 'NOT READY: no password'
    when u.email_confirmed_at is null then 'NOT READY: unconfirmed'
    when u.confirmation_token is null
      or u.recovery_token is null
      or u.email_change is null
      or u.email_change_token_new is null then 'NOT READY: null tokens'
    when not exists (
      select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
    ) then 'NOT READY: no identity'
    when p.role is distinct from 'admin'::public.app_role then 'NOT READY: role not admin'
    else 'ready'
  end as status
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = lower(:'admin_email');
