-- ============================================================================
-- FinAtt — portal sign-in tracking
--
-- HR is the top role: there is no separate admin. These counters and the
-- diagnostics they feed are gated on is_hr(), which the base migration already
-- defines.
--
-- Run after 20260721000000_finatt_full_schema.sql. Safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Where the counters live
--
-- `auth.users.last_sign_in_at` already exists, but the auth schema is not
-- exposed through PostgREST and RLS cannot reach it. Mirroring the stamp into
-- profiles makes it readable by an ordinary authenticated request.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists last_login_at timestamptz,
  add column if not exists login_count integer not null default 0;

create index if not exists profiles_last_login_idx on public.profiles (last_login_at desc);

-- ---------------------------------------------------------------------------
-- 2. Called by the login server action, on the caller's own row only.
-- ---------------------------------------------------------------------------
create or replace function public.record_login()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
     set last_login_at = now(),
         login_count   = coalesce(login_count, 0) + 1
   where id = auth.uid();
$$;

revoke all on function public.record_login() from public;
grant execute on function public.record_login() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Portal-wide statistics.
--
-- SECURITY DEFINER because it must read every profile regardless of RLS, but
-- the `where public.is_hr()` guard means a non-HR caller gets zero rows back
-- rather than an error — so headcount cannot be inferred from it.
-- ---------------------------------------------------------------------------
create or replace function public.portal_login_stats()
returns table (
  role            text,
  total           bigint,
  ever_logged_in  bigint,
  never_logged_in bigint,
  active_today    bigint,
  active_7d       bigint,
  active_30d      bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.role::text,
    count(*),
    count(*) filter (where p.last_login_at is not null),
    count(*) filter (where p.last_login_at is null),
    count(*) filter (where p.last_login_at >= date_trunc('day', now())),
    count(*) filter (where p.last_login_at >= now() - interval '7 days'),
    count(*) filter (where p.last_login_at >= now() - interval '30 days')
  from public.profiles p
  where public.is_hr()
  group by p.role::text;
$$;

revoke all on function public.portal_login_stats() from public;
grant execute on function public.portal_login_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Most recent sign-ins, for the activity list.
-- ---------------------------------------------------------------------------
create or replace function public.recent_logins(limit_count integer default 25)
returns table (
  id            uuid,
  full_name     text,
  email         text,
  role          text,
  last_login_at timestamptz,
  login_count   integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.email, p.role::text, p.last_login_at, p.login_count
  from public.profiles p
  where public.is_hr()
    and p.last_login_at is not null
  order by p.last_login_at desc
  limit greatest(1, least(coalesce(limit_count, 25), 100));
$$;

revoke all on function public.recent_logins(integer) from public;
grant execute on function public.recent_logins(integer) to authenticated;

-- Seed the counter for anyone who has already signed in at least once.
update public.profiles p
   set last_login_at = u.last_sign_in_at,
       login_count   = greatest(login_count, 1)
  from auth.users u
 where u.id = p.id
   and p.last_login_at is null
   and u.last_sign_in_at is not null;

select role::text as role, count(*) as accounts,
       count(*) filter (where last_login_at is not null) as signed_in
  from public.profiles group by role::text order by 1;
