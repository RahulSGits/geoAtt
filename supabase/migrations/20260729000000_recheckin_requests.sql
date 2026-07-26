-- ============================================================================
-- FinAtt — re-check-in requires approval
--
-- After checking out, an employee must REQUEST a re-check-in; HR/admin approves
-- it before the employee can start another session. The state lives on the
-- day's attendance row.
--
-- Run after 20260727000000_re_checkin.sql. Safe to run repeatedly.
-- ============================================================================

alter table public.attendance
  add column if not exists recheckin_status text not null default 'none',
  add column if not exists recheckin_requested_at timestamptz,
  add column if not exists recheckin_note text;

-- Guard the allowed values without a hard enum (keeps the column easy to widen).
alter table public.attendance drop constraint if exists attendance_recheckin_status_chk;
alter table public.attendance add constraint attendance_recheckin_status_chk
  check (recheckin_status in ('none', 'requested', 'approved', 'denied'));

create index if not exists attendance_recheckin_idx
  on public.attendance (recheckin_status) where recheckin_status = 'requested';

comment on column public.attendance.recheckin_status is
  'none | requested | approved | denied — gates a second check-in after check-out.';
