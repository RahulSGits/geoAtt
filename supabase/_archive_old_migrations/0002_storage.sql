-- Storage bucket for check-in selfies.
insert into storage.buckets (id, name, public)
values ('selfies', 'selfies', false)
on conflict (id) do nothing;

-- Employees can upload into a folder named after their own user id:
-- selfies/<employee_id>/<filename>.jpg
create policy "selfies insert own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "selfies read own or admin"
  on storage.objects for select
  using (
    bucket_id = 'selfies'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );
