-- ============================================================================
-- geoAtt 0005 — attendance, and the status trigger
--
-- The status ladder is ported from the old schema with its behaviour intact.
-- It belongs in the database and not in the client: it cannot be spoofed by a
-- forged request, and it cannot drift between the web app, the mobile app and
-- the CSV importer, because there is only one implementation.
-- ============================================================================

create table if not exists public.attendance (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references public.employees(id) on delete cascade,

  date                  date not null,
  check_in              timestamptz,
  check_out             timestamptz,

  status                public.attendance_status not null default 'pending',

  -- How the day was actually worked, chosen at check-in within what the site
  -- and rota allow.
  work_mode             public.work_mode not null default 'on_site',

  site_id               uuid references public.sites(id) on delete set null,

  -- Where the check-in happened. Recorded even when the fence is not enforced,
  -- so HR can see what was claimed.
  check_in_lat          double precision,
  check_in_lng          double precision,
  check_in_accuracy_m   double precision,
  check_out_lat         double precision,
  check_out_lng         double precision,

  -- Object path in the private `attendance-selfies` bucket. Evidence, not
  -- identity — the descriptor in face_templates is the identity anchor.
  check_in_selfie_path  text,
  face_match_distance   double precision,

  work_minutes          integer not null default 0,
  accumulated_minutes   integer not null default 0,
  session_count         integer not null default 1,
  is_late               boolean not null default false,

  -- Re-check-in after checking out, subject to HR approval.
  recheckin_status      public.recheckin_status not null default 'none',
  recheckin_requested_at timestamptz,
  recheckin_note        text,

  -- True when HR set the status by hand. Suppresses the trigger below, which
  -- is the whole point: a correction must not be immediately recomputed away.
  manual_override       boolean not null default false,
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- One row per employee per day. This is what makes a second check-in an
  -- update rather than a duplicate that would double-count worked minutes.
  constraint attendance_employee_date_key unique (employee_id, date),

  constraint attendance_out_after_in check (
    check_out is null or check_in is null or check_out >= check_in
  ),
  constraint attendance_minutes_non_negative check (
    work_minutes >= 0 and accumulated_minutes >= 0
  )
);

create index if not exists attendance_employee_date_idx
  on public.attendance (employee_id, date desc);
create index if not exists attendance_date_idx
  on public.attendance (date desc);
create index if not exists attendance_status_date_idx
  on public.attendance (status, date desc);

-- Partial index: the HR approval queue only ever looks at 'requested', and a
-- full index on a column that is 'none' for ~100% of rows is wasted.
create index if not exists attendance_recheckin_pending_idx
  on public.attendance (recheckin_requested_at desc)
  where recheckin_status = 'requested';

drop trigger if exists attendance_touch on public.attendance;
create trigger attendance_touch before update on public.attendance
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- compute_attendance_status
--
-- Ported from the old schema. Two corrections to the original:
--
--  1. The old version built the shift start as
--       (new.date + s.start_time) at time zone 'UTC'
--     which treats a local rota time as UTC. Anyone not on UTC had lateness
--     computed against the wrong instant — for Finance Buddha in IST that is a
--     5h30m error, so nobody was ever marked late. It now uses the configured
--     app.timezone, defaulting to Asia/Kolkata.
--
--  2. Lateness is only meaningful on a working day. Checking in on a rest day
--     no longer sets is_late.
-- ---------------------------------------------------------------------------
create or replace function public.compute_attendance_status()
returns trigger
language plpgsql
as $$
declare
  s              record;
  minutes_worked integer := 0;
  shift_start    timestamptz;
  tz             text := coalesce(nullif(current_setting('app.timezone', true), ''), 'Asia/Kolkata');
  iso_dow        smallint := extract(isodow from new.date)::smallint;
begin
  select sh.*
    into s
    from public.employees e
    join public.shifts sh on sh.id = e.shift_id
   where e.id = new.employee_id;

  if new.check_in is not null and new.check_out is not null then
    minutes_worked := greatest(
      0, floor(extract(epoch from (new.check_out - new.check_in)) / 60)::int);
  end if;

  -- Minutes banked from earlier completed sessions today, plus this one.
  new.work_minutes := minutes_worked + coalesce(new.accumulated_minutes, 0);

  -- Lateness, against the rota in local time, and only on a working day.
  if new.check_in is not null and s.id is not null
     and iso_dow = any (s.work_days) then
    shift_start := (new.date + s.start_time) at time zone tz;
    new.is_late := new.check_in > (shift_start + make_interval(mins => s.grace_minutes));
  else
    new.is_late := false;
  end if;

  -- An HR correction, or a status the ladder does not own, stands as written.
  if new.manual_override or new.status in ('leave', 'off') then
    return new;
  end if;

  if new.check_in is null then
    new.status := 'absent';
  elsif new.check_out is null then
    new.status := 'pending';
  elsif new.work_minutes >= coalesce(s.full_day_minutes, 480) then
    new.status := 'present';
  elsif new.work_minutes >= coalesce(s.half_day_minutes, 240) then
    new.status := 'half';
  else
    new.status := 'absent';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_compute_status on public.attendance;
create trigger attendance_compute_status
  before insert or update of check_in, check_out, accumulated_minutes, manual_override
  on public.attendance
  for each row execute function public.compute_attendance_status();

comment on function public.compute_attendance_status() is
  'Owns Present/Half/Absent/Pending and lateness. Deferred to by manual_override so an HR correction is not recomputed away.';
