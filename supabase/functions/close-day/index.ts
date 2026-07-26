// Supabase Edge Function: close-day
//
// Runs once daily (scheduled via pg_cron, see ../../migrations/0003_schedule.sql)
// shortly after the latest shift end time. For every employee it:
//   1. Force-closes any attendance_sessions still open from yesterday.
//   2. Sums seconds spent inside the geofence across all of yesterday's sessions.
//   3. Compares that total against the employee's shift duration * min_presence_percent.
//   4. Upserts the result into attendance_days as present / half_day / absent,
//      unless an approved leave_request already covers the date (-> on_leave).
//
// Uses the service role key so it bypasses RLS - never expose this key client-side.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const targetDate = yesterday.toISOString().slice(0, 10); // YYYY-MM-DD

  // 1. Force-close any sessions still open for the target date.
  const { error: closeError } = await supabase
    .from("attendance_sessions")
    .update({ check_out_time: new Date().toISOString() })
    .eq("date", targetDate)
    .is("check_out_time", null);

  if (closeError) {
    return new Response(JSON.stringify({ error: closeError.message }), {
      status: 500,
    });
  }

  // 2. Pull every profile along with its shift.
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, shift_id, shifts ( start_time, end_time, min_presence_percent )")
    .eq("role", "employee");

  if (profilesError) {
    return new Response(JSON.stringify({ error: profilesError.message }), {
      status: 500,
    });
  }

  // 3. Pull approved leave covering the target date.
  const { data: leaves } = await supabase
    .from("leave_requests")
    .select("employee_id")
    .lte("start_date", targetDate)
    .gte("end_date", targetDate)
    .eq("status", "approved");
  const onLeaveIds = new Set((leaves ?? []).map((l) => l.employee_id));

  const results: Array<{ employee_id: string; status: string; seconds: number }> = [];

  for (const profile of profiles ?? []) {
    const employeeId = profile.id as string;

    if (onLeaveIds.has(employeeId)) {
      await upsertDay(supabase, employeeId, targetDate, 0, "on_leave");
      results.push({ employee_id: employeeId, status: "on_leave", seconds: 0 });
      continue;
    }

    const { data: sessions } = await supabase
      .from("attendance_sessions")
      .select("check_in_time, check_out_time, inside_geofence")
      .eq("employee_id", employeeId)
      .eq("date", targetDate);

    let presentSeconds = 0;
    for (const session of sessions ?? []) {
      if (!session.inside_geofence) continue;
      const start = new Date(session.check_in_time).getTime();
      const end = session.check_out_time
        ? new Date(session.check_out_time).getTime()
        : start;
      presentSeconds += Math.max(0, Math.round((end - start) / 1000));
    }

    const shift = Array.isArray(profile.shifts) ? profile.shifts[0] : profile.shifts;
    const minPercent = shift?.min_presence_percent ?? 0.5;
    const scheduledSeconds = shift
      ? shiftDurationSeconds(shift.start_time, shift.end_time)
      : 8 * 3600;

    const requiredSeconds = scheduledSeconds * minPercent;
    let status: string;
    if (presentSeconds <= 0) {
      status = "absent";
    } else if (presentSeconds >= requiredSeconds) {
      status = "present";
    } else {
      status = "half_day";
    }

    await upsertDay(supabase, employeeId, targetDate, presentSeconds, status);
    results.push({ employee_id: employeeId, status, seconds: presentSeconds });
  }

  return new Response(JSON.stringify({ date: targetDate, results }), {
    headers: { "Content-Type": "application/json" },
  });
});

function shiftDurationSeconds(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff * 60;
}

// deno-lint-ignore no-explicit-any
async function upsertDay(
  supabase: any,
  employeeId: string,
  date: string,
  seconds: number,
  status: string,
) {
  await supabase.from("attendance_days").upsert(
    {
      employee_id: employeeId,
      date,
      total_present_seconds: seconds,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "employee_id,date" },
  );
}
