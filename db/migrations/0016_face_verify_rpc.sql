-- ============================================================================
-- geoAtt 0016 — server-side face comparison
--
-- WHY THIS EXISTS
--
-- The web computes a descriptor in the browser and then RE-COMPARES it against
-- the stored template inside a server action, so a client that lies about the
-- result is refused anyway. The mobile app has no server action, so without
-- this the comparison would happen on the phone — and a modified client could
-- simply skip it and check in as anyone.
--
-- This gives mobile the same property: the phone computes a descriptor (with
-- the same face-api model, so the numbers are comparable), and Postgres decides
-- whether it matches. The client never gets to assert "matched".
--
-- The function reads only the CALLER's own template, via current_employee_id().
-- It cannot be pointed at another employee, so it is not an oracle for testing
-- a face against the whole roster.
-- ============================================================================

/**
 * Euclidean distance between two descriptors.
 *
 * Mirrors the web's `euclidean()` exactly, including returning infinity on a
 * length mismatch rather than comparing a prefix — a truncated descriptor
 * should fail, not accidentally score well.
 */
create or replace function public.descriptor_distance(a double precision[], b double precision[])
returns double precision
language sql
immutable
as $$
  select case
    -- A large finite sentinel rather than infinity. Infinity compares
    -- correctly in SQL, but JSON cannot represent it, so it reaches the client
    -- as null — making a FAILED match indistinguishable from "never verified"
    -- once written to face_match_score. 999 fails every threshold and still
    -- survives the wire.
    when a is null or b is null or array_length(a, 1) is distinct from array_length(b, 1)
      then 999::double precision
    else sqrt((
      select coalesce(sum((a[i] - b[i]) ^ 2), 0)
      from generate_subscripts(a, 1) as i
    ))
  end;
$$;

/**
 * Compare a live descriptor against the caller's enrolled templates.
 *
 * Returns the BEST (smallest) distance across every enrolled pose, and whether
 * it clears the threshold. Older records hold a single flat descriptor rather
 * than an array of them, so both shapes are handled — the web's
 * `storedTemplates()` does the same.
 *
 * The threshold defaults to 0.5, matching MATCH_THRESHOLD in the web's
 * employee actions. It is a parameter only so it can be tuned in one place
 * later; callers should not pass their own, and the function is the authority
 * on the verdict either way.
 */
create or replace function public.verify_my_face(
  live double precision[],
  threshold double precision default 0.5
)
returns table (matched boolean, distance double precision, enrolled boolean)
language plpgsql
stable
security definer set search_path = public, pg_temp
as $$
declare
  me uuid := public.current_employee_id();
  raw jsonb;
  best double precision := 999;
  d double precision;
  pose jsonb;
begin
  if me is null then
    raise exception 'Only an employee can verify a face.';
  end if;

  select face_descriptor into raw from public.employees where id = me;

  -- No template enrolled: say so rather than returning "no match", which would
  -- send the user to retry a photo that can never succeed.
  if raw is null or jsonb_typeof(raw) <> 'array' or jsonb_array_length(raw) = 0 then
    return query select false, 999::double precision, false;
    return;
  end if;

  -- One flat descriptor (older rows) vs one array per pose (current).
  if jsonb_typeof(raw -> 0) = 'number' then
    d := public.descriptor_distance(
           live,
           array(select jsonb_array_elements_text(raw)::double precision));
    best := least(best, d);
  else
    for pose in select * from jsonb_array_elements(raw) loop
      d := public.descriptor_distance(
             live,
             array(select jsonb_array_elements_text(pose)::double precision));
      best := least(best, d);
    end loop;
  end if;

  return query select best < threshold, best, true;
end;
$$;

revoke all on function public.verify_my_face(double precision[], double precision) from public;
grant execute on function public.verify_my_face(double precision[], double precision) to authenticated;

comment on function public.verify_my_face(double precision[], double precision) is
  'Compares a live face-api descriptor against the CALLER OWN enrolled templates and returns the verdict. Exists so the phone cannot assert its own match result — the same guarantee the web gets by re-comparing inside a server action.';
