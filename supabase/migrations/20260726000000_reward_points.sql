-- ============================================================================
-- FinAtt — punctuality reward points
--
-- 3 points for checking in on time (or early) while on site. A ledger table
-- records every award so a balance can always be explained, and so the unique
-- constraint below makes awarding idempotent: re-running a check-in cannot mint
-- points twice for the same day.
-- ============================================================================

alter table public.employees
  add column if not exists reward_points integer not null default 0;

create table if not exists public.reward_events (
  id          uuid default gen_random_uuid() primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  date        date not null,
  points      integer not null,
  reason      text not null,
  created_at  timestamptz not null default now(),
  -- One award per employee per day per reason.
  unique (employee_id, date, reason)
);

create index if not exists reward_events_employee_idx on public.reward_events (employee_id, date desc);

alter table public.reward_events enable row level security;

drop policy if exists "reward_events_select_own" on public.reward_events;
create policy "reward_events_select_own" on public.reward_events
  for select using (employee_id = public.current_employee_id());

drop policy if exists "reward_events_all_hr" on public.reward_events;
create policy "reward_events_all_hr" on public.reward_events
  for all using (public.is_hr()) with check (public.is_hr());

/**
 * Award points once for a given employee/day/reason.
 *
 * Returns the points actually granted (0 if already awarded today) so the UI
 * only celebrates a real award. SECURITY DEFINER because the employees balance
 * must not be directly writable by the employee.
 */
create or replace function public.award_points(
  p_points integer,
  p_reason text,
  p_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  emp uuid;
  granted integer := 0;
begin
  select id into emp from public.employees where user_id = auth.uid();
  if emp is null then return 0; end if;

  insert into public.reward_events (employee_id, date, points, reason)
  values (emp, p_date, p_points, p_reason)
  on conflict (employee_id, date, reason) do nothing;

  if found then
    update public.employees
       set reward_points = coalesce(reward_points, 0) + p_points
     where id = emp;
    granted := p_points;
  end if;

  return granted;
end;
$$;

revoke all on function public.award_points(integer, text, date) from public;
grant execute on function public.award_points(integer, text, date) to authenticated;
