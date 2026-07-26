'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { AuthError, requireEmployee, requireSession } from '@/lib/auth'
import { checkGeofence, formatDistance, MAX_ACCEPTABLE_ACCURACY_M } from '@/lib/geo'
import { localDateKey } from '@/lib/format'
import {
  allowedWorkModes,
  enforcesGeofence,
  MAX_FACE_ENROLL_ATTEMPTS,
  PUNCTUAL_POINTS,
} from '@/lib/types'
import type { ActionResult, Attendance, Shift, Site, WorkMode } from '@/lib/types'

/** Same threshold the browser uses, re-applied here so the check is authoritative. */
const MATCH_THRESHOLD = 0.5

function fail(error: string): ActionResult<never> {
  return { ok: false, error }
}

/** Turn a thrown guard/Postgres error into a result the UI can render. */
function toResult(err: unknown): ActionResult<never> {
  if (err instanceof AuthError) return fail(err.message)
  console.error('[employee action]', err)
  return fail(err instanceof Error ? err.message : 'Something went wrong.')
}

function isDescriptor(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 128 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

function parseDescriptor(raw: FormDataEntryValue | null): number[] | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return isDescriptor(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** One template per enrolled pose. Capped so a client cannot bloat the row. */
function parseTemplates(raw: FormDataEntryValue | null): number[][] | null {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 8) return null
    return parsed.every(isDescriptor) ? (parsed as number[][]) : null
  } catch {
    return null
  }
}

function euclidean(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum)
}

/** Stored templates, tolerating both the single and multi-pose shapes. */
function storedTemplates(stored: unknown): number[][] {
  if (!Array.isArray(stored) || stored.length === 0) return []
  return Array.isArray(stored[0]) ? (stored as number[][]) : [stored as number[]]
}

/** Distance to the closest enrolled pose. */
function bestDistance(live: number[], stored: unknown): number {
  let best = Number.POSITIVE_INFINITY
  for (const template of storedTemplates(stored)) {
    const d = euclidean(live, template)
    if (d < best) best = d
  }
  return best
}

// ---------------------------------------------------------------------------
// Face enrollment
// ---------------------------------------------------------------------------

export async function enrollFace(
  formData: FormData,
): Promise<ActionResult<{ attemptsLeft: number }>> {
  try {
    const employee = await requireEmployee()

    // Prefer the multi-pose set; fall back to a single template so an older
    // client still enrolls successfully.
    const templates =
      parseTemplates(formData.get('templates')) ??
      (parseDescriptor(formData.get('descriptor'))
        ? [parseDescriptor(formData.get('descriptor'))!]
        : null)

    if (!templates) {
      return fail('The face samples were not captured correctly. Please try again.')
    }

    const supabase = await createClient()

    // Claim the attempt before writing. The check and increment happen in one
    // statement server-side, so two parallel submissions cannot both slip
    // through on the last remaining attempt. A client-side limit would be
    // bypassable by calling this action directly.
    const { data: remaining, error: claimError } = await supabase.rpc(
      'claim_face_enroll_attempt',
      { max_attempts: MAX_FACE_ENROLL_ATTEMPTS },
    )

    if (claimError) {
      // Missing function = the limit migration has not been applied. Fail
      // closed rather than silently allowing unlimited registrations.
      return fail(
        /claim_face_enroll_attempt/i.test(claimError.message)
          ? 'Face registration is not fully set up on this deployment. Ask HR to complete setup.'
          : claimError.message,
      )
    }

    if (typeof remaining === 'number' && remaining < 0) {
      return fail(
        `You have used all ${MAX_FACE_ENROLL_ATTEMPTS} face registration attempts. ` +
          'Ask HR to grant you another before trying again.',
      )
    }

    const { error } = await supabase
      .from('employees')
      .update({ face_descriptor: templates, face_enrolled_at: new Date().toISOString() })
      .eq('id', employee.id)

    if (error) return fail(error.message)

    revalidatePath('/employee')
    return { ok: true, data: { attemptsLeft: Math.max(0, Number(remaining ?? 0)) } }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Check in / check out
// ---------------------------------------------------------------------------

export async function checkIn(formData: FormData): Promise<
  ActionResult<{
    attendance: Attendance
    distance: number | null
    matchDistance: number
    /** Points granted by this check-in; 0 when late, remote, or already awarded. */
    pointsAwarded: number
  }>
> {
  try {
    const session = await requireSession()
    const employee = await requireEmployee()
    const supabase = await createClient()

    const today = localDateKey()

    const { data: existing } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('date', today)
      .maybeSingle<Attendance>()

    // Re-check-in: an employee may return after checking out (lunch, errand,
    // split shift). The finished session is banked so the day's total is the
    // sum of every session, not just the last one.
    const isResuming = Boolean(existing?.check_in && existing?.check_out)

    // A second session needs HR approval. The gate is skipped only when the
    // recheckin columns are absent (older DB) so re-check-in still works there.
    if (isResuming && existing && 'recheckin_status' in existing) {
      if (existing.recheckin_status !== 'approved') {
        return fail(
          existing.recheckin_status === 'requested'
            ? 'Your re-check-in request is awaiting HR approval.'
            : 'Request a re-check-in and wait for HR to approve it before checking in again.',
        )
      }
    }

    if (existing?.check_in && !existing.check_out) {
      return fail('You are already checked in. Check out before checking in again.')
    }

    // --- Location -----------------------------------------------------------
    const lat = Number(formData.get('latitude'))
    const lng = Number(formData.get('longitude'))
    const accuracy = Number(formData.get('accuracy'))

    if (!employee.site_id) {
      return fail('No work site is assigned to you yet. Ask HR to assign one.')
    }

    const { data: site } = await supabase
      .from('sites')
      .select('*')
      .eq('id', employee.site_id)
      .maybeSingle<Site>()

    if (!site) return fail('Your assigned work site no longer exists. Contact HR.')

    // The rota can waive the fence even at an office site.
    const { data: shift } = employee.shift_id
      ? await supabase
          .from('shifts')
          .select('work_mode')
          .eq('id', employee.shift_id)
          .maybeSingle<Pick<Shift, 'work_mode'>>()
      : { data: null }

    // The employee picks how they are working today, but only from what their
    // assignment permits — validated here, never trusted from the client.
    const permitted = allowedWorkModes(site, shift)
    const requested = String(formData.get('workMode') ?? '') as WorkMode
    const workMode: WorkMode = permitted.includes(requested) ? requested : permitted[0]

    if (requested && !permitted.includes(requested)) {
      return fail(
        `Your assignment does not allow checking in as "${requested}". Contact HR if this is wrong.`,
      )
    }

    // Position is gated only for an on-site day at a fenced office. Fencing a
    // work-from-home day is meaningless and would just lock people out.
    const geofenced = workMode === 'on_site' && enforcesGeofence(site, shift)
    let distance: number | null = null

    if (geofenced) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return fail('Your location could not be read. Enable location access and retry.')
      }
      if (Number.isFinite(accuracy) && accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
        return fail(
          `Location accuracy of ±${Math.round(accuracy)} m is too coarse to confirm you are on site.`,
        )
      }

      // Re-run the fence server-side. The browser already checked, but a client
      // can send anything, so the authoritative decision has to happen here.
      const fence = checkGeofence(
        { latitude: lat, longitude: lng, accuracy },
        { latitude: site.latitude!, longitude: site.longitude!, radius_m: site.radius_m },
      )
      distance = fence.distance
      if (!fence.inside) {
        return fail(
          `You are ${formatDistance(fence.distance)} from ${site.name}, outside its ${site.radius_m} m check-in zone.`,
        )
      }
    }

    // --- Face ---------------------------------------------------------------
    // The descriptor is compared here rather than trusting a client-sent
    // "verified: true" flag, which would be trivial to forge.
    const enrolled = storedTemplates(employee.face_descriptor)
    if (enrolled.length === 0) {
      return fail('Enroll your face before checking in.')
    }

    const live = parseDescriptor(formData.get('descriptor'))
    if (!live) return fail('The face scan was incomplete. Please try again.')

    const matchDistance = bestDistance(live, employee.face_descriptor)
    if (matchDistance >= MATCH_THRESHOLD) {
      return fail(
        'Your face did not match the enrolled photo. Face the camera in good light and retry.',
      )
    }

    if (formData.get('liveness') !== 'blink') {
      return fail('Liveness check incomplete — please blink when prompted.')
    }

    // --- Selfie (audit trail; a failure here must not block the check-in) ----
    let selfiePath: string | null = null
    const selfie = formData.get('selfie')
    if (selfie instanceof File && selfie.size > 0) {
      const path = `${session.userId}/${today}-in.jpg`
      const { error: uploadError } = await supabase.storage
        .from('selfies')
        .upload(path, selfie, { upsert: true, contentType: 'image/jpeg' })
      if (uploadError) {
        console.warn('[checkIn] selfie upload failed:', uploadError.message)
      } else {
        selfiePath = path
      }
    }

    // --- Persist ------------------------------------------------------------
    // work_minutes, is_late and status are all set by the DB trigger.
    // Bank the completed session's minutes before opening the next one.
    const banked = isResuming
      ? (existing?.accumulated_minutes ?? 0) +
        Math.max(
          0,
          Math.floor(
            (new Date(existing!.check_out!).getTime() -
              new Date(existing!.check_in!).getTime()) /
              60000,
          ),
        )
      : 0

    const row = {
      employee_id: employee.id,
      date: today,
      check_in: new Date().toISOString(),
      check_out: null,
      accumulated_minutes: banked,
      session_count: isResuming ? (existing?.session_count ?? 1) + 1 : 1,
      site_id: site.id,
      check_in_lat: Number.isFinite(lat) ? lat : null,
      check_in_lng: Number.isFinite(lng) ? lng : null,
      check_in_accuracy_m: Number.isFinite(accuracy) ? accuracy : null,
      check_in_selfie: selfiePath,
      face_match_score: matchDistance,
    }

    const save = (payload: Record<string, unknown>) =>
      supabase
        .from('attendance')
        .upsert(payload, { onConflict: 'employee_id,date' })
        .select()
        .single<Attendance>()

    // work_mode arrives with a later migration. Recording the day matters more
    // than recording how it was worked, so a missing column degrades to a
    // successful check-in rather than blocking someone from clocking on.
    let { data, error } = await save({ ...row, work_mode: workMode })

    if (error && /work_mode|accumulated_minutes|session_count/i.test(error.message)) {
      // Later-migration columns are optional; recording the check-in matters
      // more than recording its session bookkeeping.
      console.warn('[checkIn] optional column missing, retrying without it:', error.message)
      // Strip the optional columns and retry with the core row.
      const core = { ...row } as Record<string, unknown>
      delete core.accumulated_minutes
      delete core.session_count
      ;({ data, error } = await save(core))
    }

    if (error) return fail(error.message)
    if (!data) return fail('Check-in was not saved. Please try again.')

    // Consume a used approval so the next re-check-in needs a fresh request.
    if (isResuming) {
      await supabase
        .from('attendance')
        .update({ recheckin_status: 'none' })
        .eq('id', data.id)
        .then(undefined, () => {}) // best-effort; column may be absent
    }

    // Reward punctuality, but only for an on-site day that the DB trigger did
    // not flag as late. Awarding is idempotent server-side, so a repeated
    // check-in cannot mint points twice for the same day.
    let pointsAwarded = 0
    if (workMode === 'on_site' && data.is_late === false) {
      const { data: granted, error: rewardError } = await supabase.rpc('award_points', {
        p_points: PUNCTUAL_POINTS,
        p_reason: 'punctual_checkin',
        p_date: today,
      })
      if (rewardError) {
        // Points are a nicety; never fail a check-in over them.
        console.warn('[checkIn] could not award points:', rewardError.message)
      } else {
        pointsAwarded = Number(granted ?? 0)
      }
    }

    revalidatePath('/employee')
    return { ok: true, data: { attendance: data, distance, matchDistance, pointsAwarded } }
  } catch (err) {
    return toResult(err)
  }
}

export async function checkOut(formData: FormData): Promise<ActionResult<Attendance>> {
  try {
    const employee = await requireEmployee()
    const supabase = await createClient()
    const today = localDateKey()

    const { data: existing } = await supabase
      .from('attendance')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('date', today)
      .maybeSingle<Attendance>()

    if (!existing?.check_in) return fail('You have not checked in today.')
    if (existing.check_out) return fail('You have already checked out today.')

    // Check-out is face-verified exactly like check-in. Without this, anyone
    // holding the session could clock a colleague off — and the recorded hours
    // are what payroll pays against.
    const enrolled = storedTemplates(employee.face_descriptor)
    if (enrolled.length === 0) {
      return fail('Your face registration is missing. Ask HR to grant a new one.')
    }

    const live = parseDescriptor(formData.get('descriptor'))
    if (!live) return fail('The face scan was incomplete. Please try again.')

    const matchDistance = bestDistance(live, employee.face_descriptor)
    if (matchDistance >= MATCH_THRESHOLD) {
      return fail(
        'Your face did not match the registered template. Face the camera in good light and retry.',
      )
    }

    if (formData.get('liveness') !== 'blink') {
      return fail('Liveness check incomplete — please blink when prompted.')
    }

    const lat = Number(formData.get('latitude'))
    const lng = Number(formData.get('longitude'))

    const { data, error } = await supabase
      .from('attendance')
      .update({
        check_out: new Date().toISOString(),
        check_out_lat: Number.isFinite(lat) ? lat : null,
        check_out_lng: Number.isFinite(lng) ? lng : null,
      })
      .eq('id', existing.id)
      .select()
      .single<Attendance>()

    if (error) return fail(error.message)

    revalidatePath('/employee')
    return { ok: true, data }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

/**
 * Tell HR and admin that this employee needs something.
 *
 * Goes through the notify_managers RPC rather than inserting directly: RLS only
 * lets HR write to notifications, and the function is SECURITY DEFINER with the
 * recipient list fixed to active hr/admin profiles, so an employee can raise a
 * flag without being able to write into anyone's feed.
 *
 * Failure is swallowed on purpose — a missing RPC on a half-migrated deployment
 * must never turn a successful leave request into an error the employee sees.
 */
async function notifyManagers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  title: string,
  body: string,
  kind: 'info' | 'success' | 'warning' = 'info',
): Promise<void> {
  const { error } = await supabase.rpc('notify_managers', {
    p_title: title,
    p_body: body,
    p_kind: kind,
  })
  if (error) console.warn('[notify] notify_managers failed:', error.message)
}

export async function applyLeave(formData: FormData): Promise<ActionResult> {
  try {
    const employee = await requireEmployee()
    const supabase = await createClient()

    const leaveType = String(formData.get('leaveType') ?? '').trim()
    const startDate = String(formData.get('startDate') ?? '')
    const endDate = String(formData.get('endDate') ?? '')
    const reason = String(formData.get('reason') ?? '').trim()

    if (!leaveType) return fail('Choose a leave type.')
    if (!startDate || !endDate) return fail('Pick both a start and an end date.')
    if (endDate < startDate) return fail('The end date cannot be before the start date.')

    // Reject a request that overlaps one already filed, so HR never has to
    // reconcile two competing rows for the same day.
    const { data: clash } = await supabase
      .from('leaves')
      .select('id')
      .eq('employee_id', employee.id)
      .neq('status', 'rejected')
      .lte('start_date', endDate)
      .gte('end_date', startDate)
      .limit(1)

    if (clash && clash.length > 0) {
      return fail('You already have a leave request covering some of those dates.')
    }

    const { error } = await supabase.from('leaves').insert({
      employee_id: employee.id,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason: reason || null,
    })

    if (error) return fail(error.message)

    await notifyManagers(
      supabase,
      'Leave request awaiting approval',
      `${employee.full_name} requested ${leaveType} leave from ${startDate} to ${endDate}.`,
      'warning',
    )

    revalidatePath('/employee')
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

export async function cancelLeave(formData: FormData): Promise<ActionResult> {
  try {
    const employee = await requireEmployee()
    const supabase = await createClient()
    const id = String(formData.get('id') ?? '')

    const { error } = await supabase
      .from('leaves')
      .delete()
      .eq('id', id)
      .eq('employee_id', employee.id)
      .eq('status', 'pending')

    if (error) return fail(error.message)

    revalidatePath('/employee')
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function updateMyProfile(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireSession()
    const employee = await requireEmployee()
    const supabase = await createClient()

    const fullName = String(formData.get('fullName') ?? '').trim()
    const phone = String(formData.get('phone') ?? '').trim()
    const address = String(formData.get('address') ?? '').trim()
    const gender = String(formData.get('gender') ?? '').trim()

    if (!fullName) return fail('Your name cannot be empty.')

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ full_name: fullName, phone: phone || null })
      .eq('id', session.userId)

    if (profileError) return fail(profileError.message)

    const { error: employeeError } = await supabase
      .from('employees')
      .update({
        full_name: fullName,
        phone: phone || null,
        address: address || null,
        gender: gender || null,
      })
      .eq('id', employee.id)

    if (employeeError) return fail(employeeError.message)

    revalidatePath('/employee')
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

/**
 * Ask HR to allow another check-in after clocking out today. Sets the day's
 * request state to "requested"; HR approves before the employee can resume.
 */
export async function requestRecheckin(formData: FormData): Promise<ActionResult> {
  try {
    const employee = await requireEmployee()
    const supabase = await createClient()
    const today = localDateKey()

    const { data: existing } = await supabase
      .from('attendance')
      .select('id, check_in, check_out, recheckin_status')
      .eq('employee_id', employee.id)
      .eq('date', today)
      .maybeSingle<{ id: string; check_in: string | null; check_out: string | null; recheckin_status: string }>()

    if (!existing?.check_out) {
      return fail('You can only request a re-check-in after checking out.')
    }
    if (existing.recheckin_status === 'requested') {
      return fail('You already have a re-check-in request pending.')
    }
    if (existing.recheckin_status === 'approved') {
      return fail('Your re-check-in is already approved — check in again.')
    }

    const note = String(formData.get('note') ?? '').trim()
    const { error } = await supabase
      .from('attendance')
      .update({
        recheckin_status: 'requested',
        recheckin_requested_at: new Date().toISOString(),
        recheckin_note: note || null,
      })
      .eq('id', existing.id)

    if (error) {
      return fail(
        /recheckin_status/i.test(error.message)
          ? 'Re-check-in requests are not set up on this deployment yet. Ask HR.'
          : error.message,
      )
    }

    await notifyManagers(
      supabase,
      'Re-check-in request',
      `${employee.full_name} asked to check in again today${note ? `: ${note}` : '.'}`,
      'warning',
    )

    revalidatePath('/employee')
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}
