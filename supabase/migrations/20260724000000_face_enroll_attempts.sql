-- ============================================================================
-- FinAtt — limit face registration attempts
--
-- An employee may register their face twice. After that the portal refuses
-- further attempts until HR explicitly grants another, which stops someone
-- quietly re-pointing their template at a different face.
--
-- The counter lives here rather than in the client because the limit is a
-- security control: anything enforced only in the browser can be bypassed by
-- calling the server action directly.
--
-- Run after 20260721000000_finatt_full_schema.sql. Safe to run repeatedly.
-- ============================================================================

alter table public.employees
  add column if not exists face_enroll_attempts integer not null default 0,
  add column if not exists face_enroll_granted_at timestamptz,
  add column if not exists face_enroll_granted_by uuid references public.profiles(id) on delete set null;

comment on column public.employees.face_enroll_attempts is
  'Successful face registrations used. Reset to 0 by HR to grant another attempt.';

-- Existing enrollments count as one attempt already spent, so nobody starts
-- with a full allowance on top of a template they have already registered.
update public.employees
   set face_enroll_attempts = 1
 where face_descriptor is not null
   and face_enroll_attempts = 0;

/**
 * Atomically claim one attempt.
 *
 * Returns the number remaining, or -1 when the allowance is spent. Doing the
 * check and the increment in one statement closes the race where two parallel
 * submissions both read "1 remaining" and both proceed.
 */
create or replace function public.claim_face_enroll_attempt(max_attempts integer default 2)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  remaining integer;
begin
  update public.employees
     set face_enroll_attempts = face_enroll_attempts + 1
   where user_id = auth.uid()
     and face_enroll_attempts < max_attempts
  returning max_attempts - face_enroll_attempts into remaining;

  -- No row updated means the allowance was already spent.
  return coalesce(remaining, -1);
end;
$$;

revoke all on function public.claim_face_enroll_attempt(integer) from public;
grant execute on function public.claim_face_enroll_attempt(integer) to authenticated;

select employee_id, full_name, face_enroll_attempts,
       (face_descriptor is not null) as enrolled
  from public.employees order by employee_id;
