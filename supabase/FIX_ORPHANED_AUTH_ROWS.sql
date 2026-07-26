-- ===========================================================================
-- The ONE fix your database still needs. ~10 seconds.
--
-- Two rows in auth.users have NULL token columns. GoTrue reads those into a Go
-- `string`, which cannot hold NULL, so it fails while *finding* the row — which
-- is why `GET /auth/v1/admin/users` returns 500 "Database error finding users"
-- and why those rows cannot be deleted through the dashboard either.
--
-- Confirmed against this project on 2026-07-26:
--   rahulsb2024@gmail.com                 -> 400 Invalid login credentials  (healthy)
--   4994d98b-0d13-4084-b56b-d4edc1b148ef  -> 500 Database error loading user (broken)
--   acbf491f-dc37-4a35-a4a3-5193a531ad99  -> 500 Database error loading user (broken)
--
-- Only ever replaces NULL with '' — no real value is touched, and no password,
-- session or account is changed. Safe to run repeatedly.
--
-- Run in: Supabase dashboard -> SQL Editor -> paste -> Run.
-- ===========================================================================

-- Driven off information_schema so a column this GoTrue version does not have
-- is skipped rather than erroring the whole statement.
do $$
declare
  col   record;
  fixed bigint;
  total bigint := 0;
begin
  for col in
    select column_name
      from information_schema.columns
     where table_schema = 'auth'
       and table_name   = 'users'
       and data_type in ('character varying', 'text')
       and is_nullable  = 'YES'
       and column_name in (
         'confirmation_token', 'recovery_token', 'email_change',
         'email_change_token_new', 'email_change_token_current',
         'phone_change', 'phone_change_token', 'reauthentication_token'
       )
  loop
    execute format('update auth.users set %I = '''' where %I is null',
                   col.column_name, col.column_name);
    get diagnostics fixed = row_count;
    total := total + fixed;
    if fixed > 0 then
      raise notice 'auth.users.%: repaired % row(s)', col.column_name, fixed;
    end if;
  end loop;

  raise notice 'Replaced % NULL value(s).', total;
end $$;

-- Verify. Every row must read 'ok'.
select
  coalesce(u.email, '(no email)') as email,
  case
    when u.confirmation_token is null
      or u.recovery_token is null
      or u.email_change is null
      or u.email_change_token_new is null
    then 'STILL BROKEN'
    else 'ok'
  end as status
from auth.users u
order by status desc, u.email;
