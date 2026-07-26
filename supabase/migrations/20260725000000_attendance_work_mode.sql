-- ============================================================================
-- FinAtt — record how each day was actually worked
--
-- Employees whose assignment allows it may choose On-site or Work from home at
-- check-in. Storing the choice per day (rather than inferring it from the site)
-- is what makes "who was in the office last week" answerable.
--
-- Run after 20260722000000_shift_work_mode.sql. Safe to run repeatedly.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'work_mode') then
    create type public.work_mode as enum ('on_site', 'remote', 'hybrid');
  end if;
end $$;

alter table public.attendance
  add column if not exists work_mode public.work_mode not null default 'on_site';

comment on column public.attendance.work_mode is
  'How this day was worked, chosen by the employee at check-in from the modes their site and shift allow.';

create index if not exists attendance_work_mode_idx on public.attendance (work_mode, date desc);
