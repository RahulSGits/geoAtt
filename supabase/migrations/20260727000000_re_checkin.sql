-- ============================================================================
-- FinAtt — re-check-in (multiple sessions per day)
--
-- An employee may check out and back in again (lunch, an errand, a split
-- shift). Each completed session is banked into `accumulated_minutes` before
-- the next one opens, so the day's total is the sum of every session rather
-- than only the last one.
-- ============================================================================

alter table public.attendance
  add column if not exists accumulated_minutes integer not null default 0,
  add column if not exists session_count integer not null default 1;

comment on column public.attendance.accumulated_minutes is
  'Minutes banked from earlier completed sessions today, before the current check_in.';

-- Recompute worked minutes as banked + current session.
create or replace function public.compute_attendance_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s              record;
  session_minutes integer := 0;
  shift_start    timestamptz;
begin
  select sh.*
    into s
    from public.employees e
    join public.shifts sh on sh.id = e.shift_id
   where e.id = new.employee_id;

  if new.check_in is not null and new.check_out is not null then
    session_minutes := greatest(0, floor(extract(epoch from (new.check_out - new.check_in)) / 60)::int);
  end if;

  -- Earlier sessions plus the one just closed.
  new.work_minutes := coalesce(new.accumulated_minutes, 0) + session_minutes;

  if new.check_in is not null and s.id is not null then
    shift_start := (new.date + s.start_time) at time zone 'UTC';
    new.is_late := new.check_in > (shift_start + make_interval(mins => s.grace_minutes));
  end if;

  if new.manual_override
     or new.status in ('leave'::public.attendance_status, 'off'::public.attendance_status)
  then
    return new;
  end if;

  if new.check_in is null then
    new.status := 'absent'::public.attendance_status;
  elsif new.check_out is null then
    -- Mid-session: keep any banked time visible rather than showing zero.
    new.status := 'pending'::public.attendance_status;
  elsif new.work_minutes >= coalesce(s.full_day_minutes, 480) then
    new.status := 'present'::public.attendance_status;
  elsif new.work_minutes >= coalesce(s.half_day_minutes, 240) then
    new.status := 'half'::public.attendance_status;
  else
    new.status := 'absent'::public.attendance_status;
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_compute_status on public.attendance;
create trigger attendance_compute_status
  before insert or update of check_in, check_out, accumulated_minutes on public.attendance
  for each row execute function public.compute_attendance_status();
