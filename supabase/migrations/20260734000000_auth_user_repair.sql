-- ============================================================================
-- FinAtt — permanently repair auth.users rows GoTrue cannot scan.
--
-- Symptom, verbatim from this project's Supabase logs on 2026-07-26:
--
--   500 DELETE /admin/users/<id>  Error finding user: sql: Scan error on column
--                                 index 3, name "confirmation_token": converting
--                                 NULL to string is unsupported
--   500 DELETE /admin/users/<id>  Unexpected failure
--   404 DELETE /admin/users/<id>  User not found
--
-- The log names the column outright: confirmation_token, holding NULL.
--
-- Cause: auth.users has varchar columns GoTrue reads into a plain Go `string`,
-- which cannot hold NULL. Supabase's own signup path writes '' into them. A row
-- inserted by hand-written SQL that omits those columns gets NULL instead, and
-- from then on EVERY GoTrue operation that has to load that row fails while
-- scanning it -- sign-in, admin lookup, and (as above) admin delete. The delete
-- never reaches the "delete" part: it dies in "find".
--
-- The 404 is a different and harmless case: that id is genuinely not in
-- auth.users. Deleting an already-absent user is a no-op, not a fault.
--
-- FIX_LOGIN_500.sql repaired this once, by hand, and only reset passwords for
-- the three demo addresses. This migration does the same repair for EVERY row
-- and then makes the fault unrepeatable with a trigger, so a future hand-written
-- INSERT cannot reintroduce it.
--
-- Idempotent. Only ever replaces NULL -- never overwrites a real value.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Which columns must never be NULL.
--
--    Derived from the table itself rather than hard-coded, so this works across
--    GoTrue versions: the rule is "a text column whose own default is the empty
--    string is a column GoTrue expects to be non-NULL". That deliberately spares
--    email and phone, which default to NULL and are legitimately nullable.
--
--    The explicit list is unioned in as a floor, in case a deployment is missing
--    the defaults too.
-- ---------------------------------------------------------------------------
create or replace function public.auth_scalar_columns()
returns setof text
language sql stable security definer set search_path = auth, pg_temp
as $$
  select column_name::text
    from information_schema.columns
   where table_schema = 'auth'
     and table_name = 'users'
     and data_type in ('character varying', 'text')
     and is_nullable = 'YES'
     and (
       column_default like '''''%'
       or column_name in (
         'confirmation_token',
         'recovery_token',
         'email_change',
         'email_change_token_new',
         'email_change_token_current',
         'phone_change',
         'phone_change_token',
         'reauthentication_token'
       )
     )
$$;

-- Naming anon and authenticated is deliberate: Supabase's default privileges
-- grant EXECUTE on every new public function to both, so `from public` alone
-- would leave this callable over PostgREST. Same for repair_auth_users below.
revoke all on function public.auth_scalar_columns() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Repair every existing row.
-- ---------------------------------------------------------------------------
create or replace function public.repair_auth_users(target uuid default null)
returns integer
language plpgsql security definer set search_path = auth, public, pg_temp
as $$
declare
  col     text;
  fixed   bigint;
  total   integer := 0;
begin
  for col in select * from public.auth_scalar_columns() loop
    execute format(
      'update auth.users set %I = '''' where %I is null and ($1 is null or id = $1)',
      col, col
    ) using target;
    get diagnostics fixed = row_count;
    total := total + fixed;
    if fixed > 0 then
      raise notice 'auth.users.%: repaired % row(s)', col, fixed;
    end if;
  end loop;

  return total;
end;
$$;

revoke all on function public.repair_auth_users(uuid) from public, anon, authenticated;
-- service_role only: this is an operational repair, not a user-facing action.
-- The app calls it with the service key when a GoTrue admin call returns the
-- scan error, then retries the call.
grant execute on function public.repair_auth_users(uuid) to service_role;

select public.repair_auth_users() as null_values_repaired;

-- ---------------------------------------------------------------------------
-- 3. Every email user needs an identity row, or the login grant itself fails.
--    Carried over from FIX_LOGIN_500.sql so one migration leaves auth healthy.
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
-- 4. Stop it happening again.
--
--    A BEFORE trigger coerces NULL to '' on the way in, so a hand-written
--    INSERT that omits the token columns -- the exact thing that broke these
--    rows -- now produces a row GoTrue can still read. Costs one field
--    assignment per write and touches nothing that already has a value.
-- ---------------------------------------------------------------------------
-- The four columns below have existed for as long as GoTrue has; the rest
-- arrived in later versions. Assigning a column that does not exist would abort
-- the trigger, so the tail is appended to the function body only when the
-- deployment actually has those columns.
do $$
declare
  extra text;
  body  text := '';
begin
  foreach extra in array array[
    'email_change_token_current',
    'phone_change',
    'phone_change_token',
    'reauthentication_token'
  ] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'auth' and table_name = 'users' and column_name = extra
    ) then
      body := body || format('  new.%I := coalesce(new.%I, '''');%s', extra, extra, E'\n');
    end if;
  end loop;

  execute format($f$
    create or replace function public.auth_user_no_null_scalars()
    returns trigger
    language plpgsql security definer set search_path = auth, public, pg_temp
    as $body$
    begin
      new.confirmation_token     := coalesce(new.confirmation_token, '');
      new.recovery_token         := coalesce(new.recovery_token, '');
      new.email_change           := coalesce(new.email_change, '');
      new.email_change_token_new := coalesce(new.email_change_token_new, '');
    %s
      return new;
    end;
    $body$;
  $f$, body);
end $$;

drop trigger if exists auth_user_no_null_scalars on auth.users;
create trigger auth_user_no_null_scalars
  before insert or update on auth.users
  for each row execute function public.auth_user_no_null_scalars();

-- ---------------------------------------------------------------------------
-- 5. Verify. Every row must read 'ok'.
--
--    A row still reading anything else means step 2 could not reach it -- run
--    this file as the postgres/owner role rather than through PostgREST.
-- ---------------------------------------------------------------------------
select
  u.email,
  case
    when u.confirmation_token is null
      or u.recovery_token is null
      or u.email_change is null
      or u.email_change_token_new is null then 'STILL BROKEN: null tokens'
    when not exists (
      select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
    ) then 'STILL BROKEN: no email identity'
    else 'ok'
  end as gotrue_status
from auth.users u
order by u.email;
