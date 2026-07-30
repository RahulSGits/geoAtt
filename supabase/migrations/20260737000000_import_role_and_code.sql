-- ============================================================================
-- geoAtt — employee codes supplied by the CSV import must stay unique.
--
-- The importer now accepts an Employee ID from the file instead of always
-- generating EMP-000n. Two rows claiming the same code would make the code stop
-- identifying anyone, and the importer's own in-memory check cannot see a
-- concurrent import — so the guarantee belongs in the database.
--
-- Case-insensitive on purpose: "emp-0007" and "EMP-0007" are the same code to a
-- human, and the importer upper-cases before comparing.
--
-- NOTE: an earlier draft of this migration also added an `intended_role` column
-- to carry the CSV's Role value until a login was created. That has been
-- dropped. A roster row cannot hold access in the first place — authorization
-- reads `profiles.role` — so the column bought nothing, and referencing it from
-- the app broke every import and login-creation with
-- `42703 column employees.intended_role does not exist` on any database where
-- this migration had not been run. The Role column in the CSV is still
-- validated and still admin-gated; the portal is assigned from Members & access
-- once the account exists, where set_member_role enforces it in Postgres.
--
-- Idempotent.
-- ============================================================================

-- Fails loudly if duplicates already exist, which is the right outcome: they
-- must be resolved by hand rather than silently kept.
do $$
declare
  dupes int;
begin
  select count(*) into dupes
    from (
      select upper(employee_id)
        from public.employees
       where employee_id is not null
       group by upper(employee_id)
      having count(*) > 1
    ) d;

  if dupes > 0 then
    raise exception
      'Cannot add the unique index: % employee code(s) are used more than once. '
      'Run the SELECT below to find them, fix the duplicates, then re-run.', dupes;
  end if;
end $$;

create unique index if not exists employees_employee_id_key
  on public.employees (upper(employee_id));

-- Find duplicates if the block above raised:
--   select upper(employee_id) as code, count(*), array_agg(email)
--     from public.employees
--    where employee_id is not null
--    group by upper(employee_id)
--   having count(*) > 1;

select 'employee_id uniqueness applied' as status;
