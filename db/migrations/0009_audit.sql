-- ============================================================================
-- geoAtt 0009 — audit log
--
-- The old schema audited deletions and nothing else. Role changes, attendance
-- overrides, leave decisions and face-enrolment grants are all privileged acts
-- that left no trail — which is precisely the set an auditor asks about.
-- ============================================================================

create table if not exists public.audit_log (
  id           bigserial primary key,
  -- Null when the actor is the service key or a system job, which is itself
  -- worth recording rather than hiding.
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_role   public.app_role,
  action       text not null,
  entity       text not null,
  entity_id    text,
  -- Before/after, so a change can be reconstructed without a second table.
  before       jsonb,
  after        jsonb,
  reason       text,
  ip           inet,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

comment on table public.audit_log is
  'Append-only. No update or delete policy exists in 0011, so rows cannot be edited or removed through the API by any role.';

-- ---------------------------------------------------------------------------
-- Generic recorder, used by the SECURITY DEFINER functions in 0012.
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
  p_action  text,
  p_entity  text,
  p_entity_id text default null,
  p_before  jsonb default null,
  p_after   jsonb default null,
  p_reason  text default null
) returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, before, after, reason)
  values (
    auth.uid(),
    (select role from public.profiles where id = auth.uid()),
    p_action, p_entity, p_entity_id, p_before, p_after, p_reason
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Role changes are audited by trigger rather than by asking callers to
-- remember. A caller that forgets is exactly the case the log is for.
-- ---------------------------------------------------------------------------
create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role then
    insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
    values (
      auth.uid(),
      (select role from public.profiles where id = auth.uid()),
      'role.change', 'profiles', new.id::text,
      jsonb_build_object('role', old.role),
      jsonb_build_object('role', new.role)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_audit_role on public.profiles;
create trigger profiles_audit_role
  after update of role on public.profiles
  for each row execute function public.audit_role_change();

-- Attendance overridden by hand is the other act an auditor will ask about.
create or replace function public.audit_attendance_override()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.manual_override and (
       not old.manual_override
       or new.status is distinct from old.status
       or new.check_in is distinct from old.check_in
       or new.check_out is distinct from old.check_out) then
    insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, before, after, reason)
    values (
      auth.uid(),
      (select role from public.profiles where id = auth.uid()),
      'attendance.override', 'attendance', new.id::text,
      jsonb_build_object('status', old.status, 'check_in', old.check_in, 'check_out', old.check_out),
      jsonb_build_object('status', new.status, 'check_in', new.check_in, 'check_out', new.check_out),
      new.notes
    );
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_audit_override on public.attendance;
create trigger attendance_audit_override
  after update on public.attendance
  for each row execute function public.audit_attendance_override();
