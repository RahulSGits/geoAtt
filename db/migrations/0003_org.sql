-- ============================================================================
-- geoAtt 0003 — organisation: sites and shifts
--
-- Carried over from the old schema essentially unchanged. The geofence model
-- here is correct and hard-won; the only changes are constraints that were
-- previously enforced only in application code.
-- ============================================================================

create table if not exists public.sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  kind        public.site_kind not null default 'office',

  -- Null for a remote site: there is no fixed place to fence.
  latitude    double precision,
  longitude   double precision,
  radius_m    integer not null default 150,

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- An office with no coordinates is unfenceable, so the check-in flow would
  -- silently let anyone in from anywhere. Refuse the row instead.
  constraint sites_office_has_location check (
    kind <> 'office' or (latitude is not null and longitude is not null)
  ),
  constraint sites_radius_sane check (radius_m between 25 and 5000),
  constraint sites_lat_range check (latitude is null or latitude between -90 and 90),
  constraint sites_lng_range check (longitude is null or longitude between -180 and 180)
);

create unique index if not exists sites_name_key on public.sites (lower(name));
create index if not exists sites_active_idx on public.sites (is_active) where is_active;

drop trigger if exists sites_touch on public.sites;
create trigger sites_touch before update on public.sites
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- shifts — the rota, and the thresholds the attendance trigger reads.
-- ---------------------------------------------------------------------------
create table if not exists public.shifts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,

  -- Local time at the site. Stored as `time`, combined with the attendance
  -- date at comparison time.
  start_time        time not null,
  end_time          time not null,

  grace_minutes     integer not null default 15,
  full_day_minutes  integer not null default 480,
  half_day_minutes  integer not null default 240,

  -- ISO weekday numbers, 1 = Monday .. 7 = Sunday.
  work_days         smallint[] not null default '{1,2,3,4,5}',

  work_mode         public.work_mode not null default 'on_site',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint shifts_grace_sane check (grace_minutes between 0 and 240),
  constraint shifts_full_day_sane check (full_day_minutes between 1 and 1440),
  constraint shifts_half_day_sane check (half_day_minutes between 1 and 1440),

  -- Half day must be shorter than a full day, or the status ladder in 0005
  -- can never reach 'present'. The old schema checked each bound separately
  -- and allowed this contradiction.
  constraint shifts_half_below_full check (half_day_minutes < full_day_minutes)
);

create unique index if not exists shifts_name_key on public.shifts (lower(name));
create index if not exists shifts_active_idx on public.shifts (is_active) where is_active;

-- Reject a work_days array containing anything that is not an ISO weekday.
create or replace function public.shifts_validate_work_days()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from unnest(new.work_days) d where d < 1 or d > 7) then
    raise exception 'work_days must contain ISO weekday numbers 1..7, got %', new.work_days;
  end if;
  return new;
end;
$$;

drop trigger if exists shifts_check_work_days on public.shifts;
create trigger shifts_check_work_days
  before insert or update of work_days on public.shifts
  for each row execute function public.shifts_validate_work_days();

drop trigger if exists shifts_touch on public.shifts;
create trigger shifts_touch before update on public.shifts
  for each row execute function public.touch_updated_at();
