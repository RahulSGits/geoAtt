-- ============================================================================
-- FinAtt — employee notifications + realtime delivery
--
-- Gives every HR action that touches an employee a durable notification the
-- employee can see and dismiss, and puts notifications + announcements on the
-- realtime publication so they arrive without a page refresh.
--
-- Run after 20260721000000_finatt_full_schema.sql. Safe to run repeatedly.
-- NOTE: realtime must also be ON for the project (Dashboard → Database →
-- Replication). This script adds the tables to the publication; it cannot flip
-- the project-level switch.
-- ============================================================================

create table if not exists public.notifications (
  id           uuid default gen_random_uuid() primary key,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  body         text,
  kind         text not null default 'info',   -- info | success | warning
  link         text,                            -- optional in-app section key
  seen         boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unseen_idx
  on public.notifications (recipient_id) where seen = false;

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (recipient_id = auth.uid());

-- Recipients may only flip their own rows to seen (RLS can't restrict which
-- columns change, so the app updates only `seen`).
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

drop policy if exists "notifications_insert_hr" on public.notifications;
create policy "notifications_insert_hr" on public.notifications
  for insert with check (public.is_hr());

drop policy if exists "notifications_all_hr" on public.notifications;
create policy "notifications_all_hr" on public.notifications
  for all using (public.is_hr()) with check (public.is_hr());

-- ---------------------------------------------------------------------------
-- Realtime publication
--
-- Guarded: `alter publication ... add table` errors if the table is already a
-- member, which would abort the migration on a re-run.
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

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
exception
  when undefined_object then
    raise warning 'supabase_realtime publication not found; enable Realtime for the project, then re-run.';
end $$;
