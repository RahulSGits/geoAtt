-- ============================================================================
-- geoAtt 0008 — punctuality rewards
--
-- reward_events is the ledger; employees.reward_points is the running balance,
-- maintained by trigger so the two cannot disagree. The old schema updated the
-- balance from application code, which meant a failed request could bank points
-- without a matching ledger row.
-- ============================================================================

create table if not exists public.reward_events (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  points       integer not null,
  reason       text not null,
  -- The day earned. Part of the uniqueness rule below.
  date         date not null,
  created_at   timestamptz not null default now(),

  constraint reward_events_points_non_zero check (points <> 0)
);

-- One award per employee per day per reason: re-running a check-in must not
-- pay twice.
create unique index if not exists reward_events_once_per_day
  on public.reward_events (employee_id, date, reason);

create index if not exists reward_events_employee_idx
  on public.reward_events (employee_id, date desc);

create or replace function public.sync_reward_balance()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.employees
       set reward_points = reward_points + new.points
     where id = new.employee_id;
  elsif tg_op = 'DELETE' then
    update public.employees
       set reward_points = greatest(0, reward_points - old.points)
     where id = old.employee_id;
  end if;
  return null;
end;
$$;

drop trigger if exists reward_events_sync on public.reward_events;
create trigger reward_events_sync
  after insert or delete on public.reward_events
  for each row execute function public.sync_reward_balance();
