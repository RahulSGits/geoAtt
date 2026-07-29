-- ============================================================================
-- geoAtt 0010 — read models
--
-- The old system had no views. The HR dashboard fetched whole tables and
-- computed KPIs, the 14-day trend and the status mix in JavaScript — a table
-- scan shipped over the wire to do work Postgres does better. These views are
-- what the dashboard reads instead.
--
-- security_invoker = on is essential: without it a view runs as its owner and
-- silently bypasses RLS, so an employee querying it would see the whole
-- company. With it, the underlying policies still apply.
-- ============================================================================

-- The roster, joined to the names it needs, and deliberately WITHOUT face
-- templates — the whole point of splitting them out in 0004.
create or replace view public.v_employee_directory
with (security_invoker = on) as
select
  e.id,
  e.employee_code,
  e.user_id,
  p.full_name,
  p.email,
  p.phone,
  p.avatar_path,
  p.role,
  d.name          as department,
  e.department_id,
  e.designation,
  e.joining_date,
  e.status,
  e.site_id,
  s.name          as site_name,
  e.shift_id,
  sh.name         as shift_name,
  e.reward_points,
  (select count(*) from public.face_templates ft where ft.employee_id = e.id) > 0
                  as face_enrolled,
  e.created_at
from public.employees e
left join public.profiles    p  on p.id  = e.user_id
left join public.departments d  on d.id  = e.department_id
left join public.sites       s  on s.id  = e.site_id
left join public.shifts      sh on sh.id = e.shift_id;

-- One row per day: the trend chart and the status mix, already reduced.
create or replace view public.v_attendance_daily
with (security_invoker = on) as
select
  a.date,
  count(*)                                          as total,
  count(*) filter (where a.status = 'present')      as present,
  count(*) filter (where a.status = 'half')         as half,
  count(*) filter (where a.status = 'absent')       as absent,
  count(*) filter (where a.status = 'leave')        as on_leave,
  count(*) filter (where a.status = 'pending')      as pending,
  count(*) filter (where a.is_late)                 as late,
  count(*) filter (where a.work_mode = 'remote')    as remote,
  round(avg(a.work_minutes)::numeric, 1)            as avg_work_minutes
from public.attendance a
group by a.date;

create or replace view public.v_department_headcount
with (security_invoker = on) as
select
  d.id   as department_id,
  d.name as department,
  count(e.id) filter (where e.status = 'active') as active_headcount,
  count(e.id)                                    as total_headcount
from public.departments d
left join public.employees e on e.department_id = d.id
group by d.id, d.name;

-- The approval queue, with the applicant already resolved.
create or replace view public.v_leave_queue
with (security_invoker = on) as
select
  l.id,
  l.employee_id,
  e.employee_code,
  p.full_name,
  d.name as department,
  lt.name as leave_type,
  lt.is_wfh,
  l.start_date,
  l.end_date,
  (l.end_date - l.start_date) + 1 as days,
  l.reason,
  l.status,
  l.created_at
from public.leaves l
join public.employees   e  on e.id = l.employee_id
join public.leave_types lt on lt.id = l.leave_type_id
left join public.profiles    p on p.id = e.user_id
left join public.departments d on d.id = e.department_id;

-- Today at a glance, for the dashboard header.
create or replace view public.v_today_summary
with (security_invoker = on) as
select
  (select count(*) from public.employees where status = 'active')          as active_employees,
  (select count(*) from public.attendance
    where date = current_date and check_in is not null)                    as checked_in_today,
  (select count(*) from public.attendance
    where date = current_date and is_late)                                 as late_today,
  (select count(*) from public.leaves where status = 'pending')            as pending_leaves,
  (select count(*) from public.attendance
    where recheckin_status = 'requested')                                  as pending_recheckins;
