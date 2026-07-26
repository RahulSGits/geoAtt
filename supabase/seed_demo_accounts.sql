-- ============================================================================
-- FinAtt — demo accounts
--
-- Run this AFTER 20260721000000_finatt_full_schema.sql.
-- Creates (or resets) two sign-in-ready accounts:
--
--   hr@demo.com        / demo1234   -> HR console
--   employee@demo.com  / demo1234   -> Employee portal
--
-- Safe to re-run: it resets the passwords rather than duplicating the users.
-- A matching auth.identities row is created alongside each user — GoTrue needs
-- one for the account to behave like a normally-registered user.
-- ============================================================================

create extension if not exists pgcrypto;

do $$
declare
  demo record;
  uid  uuid;
begin
  for demo in
    select * from (values
      ('hr@demo.com',       'HR Demo User',       'hr'),
      ('employee@demo.com', 'Employee Demo User', 'employee')
    ) as t(email, full_name, role)
  loop
    select id into uid from auth.users where email = demo.email;

    if uid is null then
      uid := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, is_super_admin
      ) values (
        '00000000-0000-0000-0000-000000000000',
        uid,
        'authenticated',
        'authenticated',
        demo.email,
        crypt('demo1234', gen_salt('bf', 10)),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
          'full_name',        demo.full_name,
          'role',             demo.role,
          'account_status',   'active',
          'password_created', true
        ),
        now(), now(), false
      );
    else
      update auth.users
         set encrypted_password = crypt('demo1234', gen_salt('bf', 10)),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             raw_user_meta_data = jsonb_build_object(
               'full_name',        demo.full_name,
               'role',             demo.role,
               'account_status',   'active',
               'password_created', true
             ),
             updated_at = now()
       where id = uid;
    end if;

    -- GoTrue expects an identity row per provider.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', demo.email, 'email_verified', true),
      'email', now(), now(), now()
    )
    on conflict (provider, provider_id) do nothing;

    -- The auth trigger creates profile + employee rows; make sure the role and
    -- status are correct even if the account predates this script.
    update public.profiles
       set role             = demo.role::public.app_role,
           full_name        = demo.full_name,
           account_status   = 'active',
           password_created = true
     where id = uid;
  end loop;
end $$;

-- The HR user does not need an employees row; drop the one the profile trigger
-- created so the employee directory only lists actual staff.
delete from public.employees
 where user_id in (select id from public.profiles where role = 'hr'::public.app_role);
