-- ============================================================================
-- geoAtt 0006 — leave requests
-- ============================================================================

create table if not exists public.leave_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Approving a WFH leave marks the day 'WFH' rather than 'On leave'. The old
  -- schema inferred this by regex-matching the free-text type, which made
  -- "Work From Home (India)" behave differently from "WFH". A flag is explicit.
  is_wfh      boolean not null default false,
  is_paid     boolean not null default true,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists leave_types_name_key on public.leave_types (lower(name));

create table if not exists public.leaves (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id) on delete cascade,
  leave_type_id  uuid not null references public.leave_types(id) on delete restrict,

  start_date     date not null,
  end_date       date not null,
  reason         text,
  status         public.leave_status not null default 'pending',

  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint leaves_end_after_start check (end_date >= start_date),

  -- A decision must record who made it and when. The old schema allowed an
  -- approved row with no decider, which made the audit trail unreliable.
  constraint leaves_decision_complete check (
    status = 'pending' or (decided_by is not null and decided_at is not null)
  )
);

create index if not exists leaves_employee_idx on public.leaves (employee_id, start_date desc);
create index if not exists leaves_status_start_idx on public.leaves (status, start_date);
-- The approval queue only reads pending rows.
create index if not exists leaves_pending_idx on public.leaves (created_at desc)
  where status = 'pending';

-- Overlap detection, enforced rather than merely checked in the UI. Two
-- pending or approved requests for the same employee cannot cover the same day.
create extension if not exists btree_gist;
alter table public.leaves drop constraint if exists leaves_no_overlap;
alter table public.leaves add constraint leaves_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status <> 'rejected');

drop trigger if exists leaves_touch on public.leaves;
create trigger leaves_touch before update on public.leaves
  for each row execute function public.touch_updated_at();
