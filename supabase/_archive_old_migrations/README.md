# Archived migrations

These four files describe an **earlier, abandoned schema** — `attendance_sessions`,
`attendance_days`, `leave_requests`, and an `admin` role — none of which exist in the live
database. The live schema uses `attendance`, `leaves`, and the `hr` / `employee` roles.

They were moved out of `supabase/migrations/` because they would actively break a
`supabase db push`: `0001_init.sql` creates `public.sites` and `public.shifts` with
`create table if not exists`, so running it before
`20260721000000_finatt_full_schema.sql` would silently leave the wrong column set in place
and the app's queries would fail against it.

Kept for reference only. Nothing here should be run.
