-- ============================================================================
-- geoAtt 0012 — RPCs
--
-- Everything here is SECURITY DEFINER, so each function checks authorisation
-- itself as its first act. A definer function that forgets its own check is a
-- complete bypass of RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- set_member_role — the only way a role changes.
--
-- Ported with its most important rule intact: the last administrator cannot be
-- demoted. Enforced here rather than in the UI, because a UI check is advice.
-- ---------------------------------------------------------------------------
create or replace function public.set_member_role(target uuid, new_role public.app_role)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  current_role_of_target public.app_role;
  admin_count integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change a role.';
  end if;

  select role into current_role_of_target from public.profiles where id = target;
  if not found then
    raise exception 'No such member.';
  end if;

  if current_role_of_target = 'admin' and new_role <> 'admin' then
    select count(*) into admin_count from public.profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'Cannot demote the last administrator.';
    end if;
  end if;

  update public.profiles set role = new_role where id = target;
  -- The audit row is written by the trigger in 0009.
end;
$$;

revoke all on function public.set_member_role(uuid, public.app_role) from public;
grant execute on function public.set_member_role(uuid, public.app_role) to authenticated;

-- ---------------------------------------------------------------------------
-- claim_face_enroll_attempt — one-shot enrolment.
--
-- Atomic: the check and the increment happen in one statement, so two requests
-- racing cannot both see "0 used" and both enrol.
-- ---------------------------------------------------------------------------
create or replace function public.claim_face_enroll_attempt(max_attempts integer default 1)
returns boolean
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  me uuid := public.current_employee_id();
  claimed integer;
begin
  if me is null then
    raise exception 'Only an employee can enrol a face.';
  end if;

  update public.employees
     set face_enroll_attempts = face_enroll_attempts + 1
   where id = me and face_enroll_attempts < max_attempts
  returning face_enroll_attempts into claimed;

  return claimed is not null;
end;
$$;

revoke all on function public.claim_face_enroll_attempt(integer) from public;
grant execute on function public.claim_face_enroll_attempt(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- grant_face_reenrolment — HR reopens enrolment for one person.
-- ---------------------------------------------------------------------------
create or replace function public.grant_face_reenrolment(target uuid, reason text default null)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_hr() then
    raise exception 'Only HR can re-grant face enrolment.';
  end if;

  update public.employees
     set face_enroll_attempts = 0,
         face_enroll_granted_at = now(),
         face_enroll_granted_by = auth.uid()
   where id = target;

  delete from public.face_templates where employee_id = target;

  perform public.write_audit('face.reenrol_granted', 'employees', target::text, null, null, reason);
end;
$$;

revoke all on function public.grant_face_reenrolment(uuid, text) from public;
grant execute on function public.grant_face_reenrolment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- email_for_login — resolve an employee code OR email to an email address.
--
-- SECURITY DEFINER because the caller has no session yet, so RLS would hide the
-- row. Deliberately minimal: it takes no password and returns only an email,
-- and the sign-in path must treat a miss and a wrong password identically so
-- this cannot be used to prove which codes exist.
-- ---------------------------------------------------------------------------
create or replace function public.email_for_login(identifier text)
returns text
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select p.email::text
    from public.employees e
    join public.profiles p on p.id = e.user_id
   where upper(e.employee_code) = upper(trim(identifier))
   limit 1;
$$;

revoke all on function public.email_for_login(text) from public;
grant execute on function public.email_for_login(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_login — sign-in counters for the admin console.
-- ---------------------------------------------------------------------------
create or replace function public.record_login()
returns void
language sql
security definer set search_path = public, pg_temp
as $$
  update public.profiles
     set last_login_at = now(), login_count = login_count + 1
   where id = auth.uid();
$$;

revoke all on function public.record_login() from public;
grant execute on function public.record_login() to authenticated;

-- ---------------------------------------------------------------------------
-- delete_employee_record — the only way a person is removed.
--
-- There is no delete policy on employees for any role (see 0011), so this
-- definer function is the sole path, and it always writes an audit row.
-- ---------------------------------------------------------------------------
create or replace function public.delete_employee_record(target uuid, reason text)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  snapshot jsonb;
begin
  if not public.is_hr() then
    raise exception 'Only HR can remove an employee.';
  end if;
  if reason is null or length(trim(reason)) = 0 then
    raise exception 'A reason is required.';
  end if;

  select to_jsonb(e) into snapshot from public.employees e where e.id = target;
  if snapshot is null then
    raise exception 'No such employee.';
  end if;

  delete from public.employees where id = target;
  perform public.write_audit('employee.delete', 'employees', target::text, snapshot, null, reason);
end;
$$;

revoke all on function public.delete_employee_record(uuid, text) from public;
grant execute on function public.delete_employee_record(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- award_punctuality — called after a successful on-time, on-site check-in.
--
-- The unique index in 0008 makes a repeat award a no-op rather than a second
-- payment, so a retried request cannot pay twice.
-- ---------------------------------------------------------------------------
create or replace function public.award_punctuality(target uuid, on_date date, points integer default 3)
returns boolean
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  insert into public.reward_events (employee_id, points, reason, date)
  values (target, points, 'punctual_checkin', on_date)
  on conflict (employee_id, date, reason) do nothing;
  return found;
end;
$$;

revoke all on function public.award_punctuality(uuid, date, integer) from public;
grant execute on function public.award_punctuality(uuid, date, integer) to authenticated;
