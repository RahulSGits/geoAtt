-- ============================================================================
-- FinAtt — make notifications work in both directions, for every role
--
-- Fixes two faults in 20260728000000_notifications_realtime.sql:
--
--   1. `notifications_all_hr` granted HR/admin `for all using (is_hr())`, which
--      includes SELECT. Every HR user could therefore read every other user's
--      notifications, and the bell in the HR console listed the whole company's
--      feed. HR needs to *write* notifications, not read other people's.
--
--   2. Insert was restricted to is_hr(), so an employee submitting a leave or
--      re-check-in request could not notify anyone. Requests arrived silently
--      and HR only saw them by reloading the page.
--
-- Run after 20260728000000_notifications_realtime.sql. Safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reading stays strictly personal — for everyone, HR and admin included.
-- ---------------------------------------------------------------------------
drop policy if exists "notifications_all_hr" on public.notifications;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (recipient_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Let people clear their own feed.
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (recipient_id = auth.uid());

-- HR/admin keep the ability to send.
drop policy if exists "notifications_insert_hr" on public.notifications;
create policy "notifications_insert_hr" on public.notifications
  for insert with check (public.is_hr());

-- ---------------------------------------------------------------------------
-- 2. Employee -> management notifications.
--
-- SECURITY DEFINER because an employee has no insert rights of their own. The
-- function is deliberately narrow: the caller chooses only the text, never the
-- recipient, so it cannot be used to write into an arbitrary person's feed.
-- ---------------------------------------------------------------------------
create or replace function public.notify_managers(
  p_title text,
  p_body  text,
  p_kind  text default 'info'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sent integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'notification needs a title';
  end if;

  insert into public.notifications (recipient_id, title, body, kind)
  select p.id,
         left(p_title, 200),
         left(coalesce(p_body, ''), 1000),
         case when p_kind in ('info', 'success', 'warning') then p_kind else 'info' end
    from public.profiles p
   where p.role in ('hr', 'admin')
     and coalesce(p.account_status, 'active') = 'active';

  get diagnostics sent = row_count;
  return sent;
end;
$$;

grant execute on function public.notify_managers(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Housekeeping: a feed nobody prunes grows without bound.
-- ---------------------------------------------------------------------------
create or replace function public.prune_old_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from public.notifications
   where seen = true
     and created_at < now() - interval '60 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Make sure realtime still carries both tables.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception
  when undefined_object then
    raise warning 'supabase_realtime publication not found; enable Realtime, then re-run.';
end $$;
