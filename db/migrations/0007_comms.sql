-- ============================================================================
-- geoAtt 0007 — announcements and notifications
-- ============================================================================

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  priority    public.priority not null default 'normal',
  created_by  uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),

  constraint announcements_expiry_after_publish check (
    expires_at is null or expires_at > published_at
  )
);

create index if not exists announcements_feed_idx
  on public.announcements (published_at desc);

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  -- Scoped to one person. RLS enforces it AND the application filters on it —
  -- defence in depth, so a policy widened later cannot quietly put the whole
  -- company's feed in one person's bell.
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  body          text,
  kind          text not null default 'info',
  link          text,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),

  constraint notifications_kind_valid check (kind in ('info', 'success', 'warning', 'error'))
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

-- The bell badge counts unread only; a partial index keeps that cheap as the
-- table grows.
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id, created_at desc) where read_at is null;

-- Notifications are ephemeral. Without pruning this becomes the largest table
-- in the database and the one nobody reads.
create or replace function public.prune_notifications(older_than interval default '90 days')
returns integer
language sql
security definer set search_path = public, pg_temp
as $$
  with gone as (
    delete from public.notifications
     where created_at < now() - older_than and read_at is not null
    returning 1
  ) select count(*)::int from gone;
$$;
