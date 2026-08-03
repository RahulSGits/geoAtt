-- ============================================================================
-- geoAtt 0015 — leave types, and the last of the naming drift
--
-- 0014 reconciled `employees` and `profiles` with the shipped frontend. This
-- finishes the job for the three tables that were still mismatched. Each was
-- found by comparing information_schema against what the web code actually
-- reads and writes, not by waiting for the next red banner.
--
-- WHERE A PLAIN RENAME IS USED
--
-- For a straight naming difference the physical column is renamed to the name
-- the frontend uses, rather than adding a second column and syncing it. The
-- frontend is the authority here — my names in 0005/0007 were arbitrary
-- improvements — and one column cannot drift from itself. Duplication is only
-- worth its cost where two consumers genuinely need different shapes, which is
-- the employees/profiles case in 0014.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. announcements.body -> description
--
-- The HR console reads and writes `description`. Nothing else references
-- `body`: no view selects it, so the rename is contained.
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='announcements' and column_name='body')
     and not exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='announcements' and column_name='description') then
    alter table public.announcements rename column body to description;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. attendance: two columns the check-in flow writes under other names.
--
--   check_in_selfie_path -> check_in_selfie
--   face_match_distance  -> face_match_score
--
-- The second is not only a rename, it is a correction. The value stored is a
-- Euclidean *distance* between descriptors, where smaller means a better
-- match — the check-in action rejects when it is >= MATCH_THRESHOLD. Calling
-- it a "score" reads as higher-is-better and invites exactly the wrong
-- comparison. The frontend name wins for compatibility, so the meaning is
-- recorded on the column instead.
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='attendance' and column_name='check_in_selfie_path')
     and not exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='attendance' and column_name='check_in_selfie') then
    alter table public.attendance rename column check_in_selfie_path to check_in_selfie;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='attendance' and column_name='face_match_distance')
     and not exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='attendance' and column_name='face_match_score') then
    alter table public.attendance rename column face_match_distance to face_match_score;
  end if;
end $$;

comment on column public.attendance.face_match_score is
  'Euclidean distance between the live and enrolled face descriptors. LOWER IS A BETTER MATCH — check-in rejects at or above the threshold. Named "score" for frontend compatibility; it is not one.';

comment on column public.attendance.check_in_selfie is
  'Object path in the private attendance-selfies bucket, not a URL. Signed URLs expire, so storing one would persist a dead link.';

-- ---------------------------------------------------------------------------
-- 3. leaves: the frontend files a leave type by NAME, not by id.
--
-- 0006 modelled this properly as leave_type_id -> leave_types, which is the
-- right shape and which the HR console's WFH rule depends on (approving a WFH
-- leave marks the day WFH rather than On leave, and inferring that by
-- regex-matching free text made "Work From Home (India)" behave differently
-- from "WFH").
--
-- But the employee portal inserts `leave_type: 'Casual'`. Both must work, so
-- the text column comes back and a trigger keeps it in step with the foreign
-- key in whichever direction the write arrives. Unlike the renames above this
-- is genuine duplication, and it earns it: the id preserves the WFH flag while
-- the text keeps the shipped frontend working.
-- ---------------------------------------------------------------------------
alter table public.leaves
  add column if not exists leave_type text;

-- The five the employee portal offers. is_wfh drives the HR approval rule.
insert into public.leave_types (name, is_wfh, is_paid, is_active) values
  ('Casual',         false, true,  true),
  ('Sick',           false, true,  true),
  ('Earned',         false, true,  true),
  ('Unpaid',         false, false, true),
  ('Work from home', true,  true,  true)
on conflict do nothing;

-- leave_type_id was NOT NULL in 0006, which a text-only insert cannot satisfy.
-- The trigger below fills it, but it runs BEFORE INSERT and the constraint is
-- checked after, so the column has to allow null in between.
alter table public.leaves alter column leave_type_id drop not null;

/**
 * Keep the name and the foreign key agreeing, whichever one was written.
 *
 * An unknown name creates the type rather than rejecting the request. Losing
 * someone's leave application to a typo in a dropdown nobody can edit from the
 * phone is a worse failure than an extra row in a small lookup table, and HR
 * can merge or deactivate it afterwards.
 */
create or replace function public.sync_leave_type()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  found_id uuid;
begin
  if new.leave_type is not null and new.leave_type <> '' then
    select id into found_id from public.leave_types where lower(name) = lower(new.leave_type);
    if found_id is null then
      insert into public.leave_types (name, is_wfh, is_paid, is_active)
      values (
        new.leave_type,
        -- Matches the web's isWfhLeave() so a newly seen name still lands on
        -- the right side of the approval rule.
        new.leave_type ~* 'work\s*from\s*home|wfh|remote',
        true, true)
      returning id into found_id;
    end if;
    new.leave_type_id := found_id;

  elsif new.leave_type_id is not null then
    select name into new.leave_type from public.leave_types where id = new.leave_type_id;
  end if;

  return new;
end;
$$;

drop trigger if exists leaves_sync_type on public.leaves;
create trigger leaves_sync_type
  before insert or update of leave_type, leave_type_id on public.leaves
  for each row execute function public.sync_leave_type();

-- Backfill rows written before the trigger existed.
update public.leaves l
   set leave_type = t.name
  from public.leave_types t
 where t.id = l.leave_type_id and l.leave_type is distinct from t.name;

-- The employee portal filters its own requests by type; the HR queue by status.
create index if not exists leaves_type_idx on public.leaves (leave_type);

-- ---------------------------------------------------------------------------
-- 4. v_leave_queue selected lt.name; keep it working after the change.
-- ---------------------------------------------------------------------------
drop view if exists public.v_leave_queue;
create view public.v_leave_queue
with (security_invoker = on) as
select
  l.id,
  l.employee_id,
  e.employee_id  as employee_code,
  e.full_name,
  e.department,
  coalesce(l.leave_type, lt.name) as leave_type,
  lt.is_wfh,
  l.start_date,
  l.end_date,
  (l.end_date - l.start_date) + 1 as days,
  l.reason,
  l.status,
  l.created_at
from public.leaves l
join public.employees e on e.id = l.employee_id
left join public.leave_types lt on lt.id = l.leave_type_id;
