-- ============================================================================
-- geoAtt 0013 — storage buckets
--
-- All four are PRIVATE. A public bucket for attendance selfies would put every
-- employee's face on a guessable URL.
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('avatars',            'avatars',            false),
  ('attendance-selfies', 'attendance-selfies', false),
  ('documents',          'documents',          false),
  ('csv-imports',        'csv-imports',        false)
on conflict (id) do update set public = false;

-- Convention: every object is stored under the owning user's UID as the first
-- path segment, e.g. avatars/<uid>/avatar.jpg. The policies below rely on it.
--
-- The shape is validated with a regex rather than by casting inside an
-- exception handler, for two reasons: `language sql` cannot have an EXCEPTION
-- block at all (that is plpgsql only, and the function would fail to create),
-- and a plpgsql handler opens a subtransaction per call — which this cannot
-- afford, because every storage policy below invokes it for every row.
--
-- Returns null for any path that does not start with a UUID segment, and a
-- null owner matches nobody, so a malformed key is denied rather than shared.
create or replace function public.storage_owner_uid(name text)
returns uuid
language sql
immutable
as $$
  select case
    when (string_to_array(name, '/'))[1] ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((string_to_array(name, '/'))[1])::uuid
  end;
$$;

-- ── avatars ────────────────────────────────────────────────────────────────
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (
    bucket_id = 'avatars'
    and (public.storage_owner_uid(name) = auth.uid() or public.is_hr())
  );

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects
  for insert with check (
    bucket_id = 'avatars' and public.storage_owner_uid(name) = auth.uid()
  );

-- WITH CHECK as well as USING: without it an update could rename the object
-- into someone else's prefix, which USING alone would still permit because it
-- only tests the row as it stands before the change.
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars' and public.storage_owner_uid(name) = auth.uid()
  ) with check (
    bucket_id = 'avatars' and public.storage_owner_uid(name) = auth.uid()
  );

-- ── attendance-selfies ─────────────────────────────────────────────────────
-- Readable by their owner and by HR. Never updated or deleted by the employee:
-- a selfie is evidence for a check-in that already happened.
drop policy if exists selfies_read on storage.objects;
create policy selfies_read on storage.objects
  for select using (
    bucket_id = 'attendance-selfies'
    and (public.storage_owner_uid(name) = auth.uid() or public.is_hr())
  );

drop policy if exists selfies_write_own on storage.objects;
create policy selfies_write_own on storage.objects
  for insert with check (
    bucket_id = 'attendance-selfies' and public.storage_owner_uid(name) = auth.uid()
  );

-- ── documents and csv-imports ──────────────────────────────────────────────
drop policy if exists documents_hr on storage.objects;
create policy documents_hr on storage.objects
  for all using (bucket_id = 'documents' and public.is_hr())
  with check (bucket_id = 'documents' and public.is_hr());

drop policy if exists csv_imports_hr on storage.objects;
create policy csv_imports_hr on storage.objects
  for all using (bucket_id = 'csv-imports' and public.is_hr())
  with check (bucket_id = 'csv-imports' and public.is_hr());
