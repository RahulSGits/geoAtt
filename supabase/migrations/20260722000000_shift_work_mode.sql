-- ============================================================================
-- FinAtt — work mode on shifts
--
-- Small delta on top of 20260721000000_finatt_full_schema.sql, so it can be
-- pasted on its own without re-running the 500-line base migration.
--
-- Sites already carry a `kind` (office / remote / hybrid). This adds the same
-- idea to shifts, because the two answer different questions:
--
--   site.kind        — where this location is, and whether it can be fenced
--   shift.work_mode  — how *this rota* is worked, regardless of the location
--
-- Precedence: the geofence applies only when the site is an office AND the
-- shift is on-site. A remote shift is never fenced, even at an office site —
-- otherwise a work-from-home rota attached to the head office would lock
-- everyone out.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'work_mode') then
    create type public.work_mode as enum ('on_site', 'remote', 'hybrid');
  end if;
end $$;

alter table public.shifts
  add column if not exists work_mode public.work_mode not null default 'on_site';

-- Seeded rotas: give the night shift a hybrid mode so the three demo shifts
-- show all three states, but only when they are still at the default.
update public.shifts
   set work_mode = 'hybrid'::public.work_mode
 where name = 'Night Shift'
   and work_mode = 'on_site'::public.work_mode;

comment on column public.shifts.work_mode is
  'How the rota is worked. Combined with sites.kind to decide whether check-in is geofenced.';
