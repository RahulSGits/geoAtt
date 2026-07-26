-- ===========================================================================
-- Repairs sign-in failing with HTTP 500 "Database error querying schema".
--
-- Confirmed against this project on 2026-07-23 by sending a deliberately wrong
-- password to /auth/v1/token for each account:
--
--   hr@demo.com        -> 400 Invalid login credentials   (row is healthy)
--   admin@demo.com     -> 500 Database error querying schema
--   employee@demo.com  -> 500 Database error querying schema
--
-- A wrong password returning 500 instead of 400 proves the password is never
-- checked, and one healthy row alongside two broken ones proves the damage is
-- per-row, not a project-wide misconfiguration.
--
-- Cause: auth.users has varchar columns that GoTrue reads into a Go `string`,
-- which cannot hold NULL. Supabase's signup path writes '' into them; a row
-- inserted by hand-written SQL that omits them gets NULL, and GoTrue then fails
-- to scan that row on every sign-in attempt.
--
-- Safe to run repeatedly. Only ever replaces NULL, never a real value.
-- Run in: Supabase dashboard -> SQL Editor -> paste -> Run.
-- ===========================================================================

-- Supabase installs pgcrypto into the `extensions` schema, but some projects
-- have it in `public`. Naming both means crypt()/gen_salt() resolve either way,
-- instead of failing with "function crypt(...) does not exist".
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Replace the unscannable NULLs.
-- ---------------------------------------------------------------------------
do $$
declare
  col record;
  fixed bigint;
  total bigint := 0;
begin
  -- Driven off information_schema so this works across GoTrue versions: a
  -- column this deployment does not have is simply skipped.
  for col in
    select column_name
      from information_schema.columns
     where table_schema = 'auth'
       and table_name = 'users'
       and data_type in ('character varying', 'text')
       and column_name in (
         'confirmation_token',
         'recovery_token',
         'email_change',
         'email_change_token_new',
         'email_change_token_current',
         'phone_change',
         'phone_change_token',
         'reauthentication_token'
       )
  loop
    execute format(
      'update auth.users set %I = '''' where %I is null', col.column_name, col.column_name
    );
    get diagnostics fixed = row_count;
    total := total + fixed;
    if fixed > 0 then
      raise notice 'auth.users.%: repaired % row(s)', col.column_name, fixed;
    end if;
  end loop;

  raise notice 'Replaced % NULL value(s) with empty strings.', total;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Every email user needs an identity row, or the login grant itself fails.
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
-- 3. Confirm the demo addresses and set their password back to demo1234.
--    Scoped to the three demo accounts on purpose — no real user is touched.
-- ---------------------------------------------------------------------------
update auth.users
   set encrypted_password = crypt('demo1234', gen_salt('bf', 10)),
       email_confirmed_at = coalesce(email_confirmed_at, now()),
       updated_at = now()
 where lower(email) in ('admin@demo.com', 'hr@demo.com', 'employee@demo.com');

-- ---------------------------------------------------------------------------
-- 4. Verify. Every row must read 'ok'.
-- ---------------------------------------------------------------------------
select
  u.email,
  case
    when u.confirmation_token is null
      or u.recovery_token is null
      or u.email_change is null
      or u.email_change_token_new is null then 'STILL BROKEN: null tokens'
    when u.email_confirmed_at is null then 'STILL BROKEN: email not confirmed'
    when not exists (
      select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
    ) then 'STILL BROKEN: no email identity'
    else 'ok'
  end as sign_in_status
from auth.users u
order by u.email;
