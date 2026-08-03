import { requireSupabase } from './supabase'

/**
 * Employee-facing data access, against the same Supabase project and the same
 * tables the web app uses. Nothing here is mobile-specific storage — one
 * backend, one row per employee per day, whichever client wrote it.
 *
 * Row Level Security does the authorisation. Every query below is scoped by
 * the caller's own session, so `attendance_select` and friends already limit
 * results to this employee; the explicit `.eq('employee_id', …)` filters are
 * for the query planner, not for safety.
 */

export type Employee = {
  id: string
  employee_id: string
  full_name: string | null
  email: string | null
  designation: string | null
  department: string | null
  status: string
  site_id: string | null
  shift_id: string | null
  reward_points: number
}

export type Attendance = {
  id: string
  date: string
  check_in: string | null
  check_out: string | null
  status: string
  work_minutes: number
  is_late: boolean
  work_mode: string
}

export type Site = {
  id: string
  name: string
  kind: 'office' | 'remote' | 'hybrid'
  latitude: number | null
  longitude: number | null
  radius_m: number
}

export type Shift = {
  id: string
  name: string
  start_time: string
  end_time: string
  grace_minutes: number
}

/** `YYYY-MM-DD` in the device's local timezone, not UTC. */
export function localDateKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The signed-in user's employee row.
 *
 * Returns null rather than throwing when there is none. An admin or HR account
 * legitimately has no employees row — that absence is what makes employee-only
 * actions reject them — so "no row" is a state to render, not an error.
 */
export async function getMyEmployee(): Promise<Employee | null> {
  const { data, error } = await requireSupabase()
    .from('employees')
    .select(
      'id, employee_id, full_name, email, designation, department, status, site_id, shift_id, reward_points',
    )
    .maybeSingle()

  if (error) throw error
  return (data as Employee) ?? null
}

export async function getSite(id: string | null): Promise<Site | null> {
  if (!id) return null
  const { data, error } = await requireSupabase()
    .from('sites')
    .select('id, name, kind, latitude, longitude, radius_m')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as Site) ?? null
}

export async function getShift(id: string | null): Promise<Shift | null> {
  if (!id) return null
  const { data, error } = await requireSupabase()
    .from('shifts')
    .select('id, name, start_time, end_time, grace_minutes')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as Shift) ?? null
}

export async function getToday(employeeId: string): Promise<Attendance | null> {
  const { data, error } = await requireSupabase()
    .from('attendance')
    .select('id, date, check_in, check_out, status, work_minutes, is_late, work_mode')
    .eq('employee_id', employeeId)
    .eq('date', localDateKey())
    .maybeSingle()
  if (error) throw error
  return (data as Attendance) ?? null
}

export async function getHistory(employeeId: string, days = 35): Promise<Attendance[]> {
  // 35 days by default, not 14: monthStats needs the whole calendar month, and
  // on the 31st a 14-day window would silently omit half of it.
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await requireSupabase()
    .from('attendance')
    .select('id, date, check_in, check_out, status, work_minutes, is_late, work_mode')
    .eq('employee_id', employeeId)
    .gte('date', localDateKey(since))
    .order('date', { ascending: false })
  if (error) throw error
  return (data as Attendance[]) ?? []
}

export type Coords = { latitude: number; longitude: number; accuracy: number | null }

/**
 * Distance in metres between two points.
 *
 * Haversine, matching the web app's geofence maths so a check-in is judged the
 * same whichever client makes it.
 */
export function distanceMetres(a: Coords, b: { latitude: number; longitude: number }): number {
  const R = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Whether the geofence applies. Mirrors `enforcesGeofence` in the web app:
 * only an office site with real coordinates fences anyone. Remote and hybrid
 * record the location without enforcing it.
 */
export function enforcesGeofence(site: Site | null): boolean {
  return !!site && site.kind === 'office' && site.latitude !== null && site.longitude !== null
}

/**
 * Start the day.
 *
 * The row is keyed by (employee_id, date), which the schema enforces as unique,
 * so an upsert makes a repeated tap idempotent instead of creating a second row
 * that would double-count worked minutes.
 *
 * status, work_minutes and is_late are deliberately NOT set here — the
 * compute_attendance_status trigger owns them. Setting them client-side is
 * exactly the spoofing the trigger exists to prevent.
 */
export async function checkIn(
  employeeId: string,
  siteId: string | null,
  coords: Coords | null,
  workMode: 'on_site' | 'remote' = 'on_site',
): Promise<void> {
  const { error } = await requireSupabase()
    .from('attendance')
    .upsert(
      {
        employee_id: employeeId,
        date: localDateKey(),
        check_in: new Date().toISOString(),
        site_id: siteId,
        work_mode: workMode,
        check_in_lat: coords?.latitude ?? null,
        check_in_lng: coords?.longitude ?? null,
        check_in_accuracy_m: coords?.accuracy ?? null,
      },
      { onConflict: 'employee_id,date' },
    )
  if (error) throw error
}

export async function checkOut(attendanceId: string, coords: Coords | null): Promise<void> {
  const { error } = await requireSupabase()
    .from('attendance')
    .update({
      check_out: new Date().toISOString(),
      check_out_lat: coords?.latitude ?? null,
      check_out_lng: coords?.longitude ?? null,
    })
    .eq('id', attendanceId)
  if (error) throw error
}

/** `9h 05m` from a minute count. */
export function formatDuration(minutes: number): string {
  if (!minutes) return '0h 00m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** `09:05` in the device's locale, from an ISO timestamp. */
export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Balance at which a reward can be claimed. Mirrors the web's types.ts. */
export const REWARD_GOAL = 1000

// ── Leave ──────────────────────────────────────────────────────────────────

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export type Leave = {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  reason: string | null
  status: LeaveStatus
  decision_note: string | null
  created_at: string
}

export type LeaveType = { id: string; name: string; is_wfh: boolean }

export async function getLeaveTypes(): Promise<LeaveType[]> {
  const { data, error } = await requireSupabase()
    .from('leave_types')
    .select('id, name, is_wfh')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data as LeaveType[]) ?? []
}

export async function getLeaves(employeeId: string): Promise<Leave[]> {
  const { data, error } = await requireSupabase()
    .from('leaves')
    .select('id, leave_type, start_date, end_date, reason, status, decision_note, created_at')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false })
  if (error) throw error
  return (data as Leave[]) ?? []
}

/**
 * File a leave request.
 *
 * The overlap check mirrors the web's applyLeave: a request that covers a day
 * already claimed by a pending or approved one is refused, so HR never has to
 * reconcile two competing rows for the same date. Rejected requests are
 * excluded — those days are free again.
 *
 * The database enforces the same rule with an exclusion constraint, so a race
 * between two devices still cannot land both. This check exists to turn that
 * constraint violation into a sentence a person can act on.
 *
 * `leave_type` is written as text. A trigger resolves it to leave_types and
 * fills leave_type_id, which is what carries the WFH flag through to HR's
 * approval rule.
 */
export async function applyLeave(input: {
  employeeId: string
  leaveType: string
  startDate: string
  endDate: string
  reason: string
}): Promise<void> {
  const supabase = requireSupabase()

  const { data: clash } = await supabase
    .from('leaves')
    .select('id')
    .eq('employee_id', input.employeeId)
    .neq('status', 'rejected')
    .lte('start_date', input.endDate)
    .gte('end_date', input.startDate)
    .limit(1)

  if (clash && clash.length > 0) {
    throw new Error('You already have a leave request covering some of those dates.')
  }

  const { error } = await supabase.from('leaves').insert({
    employee_id: input.employeeId,
    leave_type: input.leaveType,
    start_date: input.startDate,
    end_date: input.endDate,
    reason: input.reason.trim() || null,
    status: 'pending',
  })
  if (error) throw error
}

/**
 * Withdraw a request.
 *
 * Only a pending one, matching the web and the RLS policy: once HR has decided,
 * the record is theirs and the employee cannot quietly remove the evidence.
 */
export async function withdrawLeave(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('leaves')
    .delete()
    .eq('id', id)
    .eq('status', 'pending')
  if (error) throw error
}

/** Inclusive day count, the way the leave queue counts it. */
export function leaveDays(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

/**
 * This month's figures, computed exactly as the web's `monthStats` does.
 *
 * The rate counts a half day as half a day present, over days that were
 * actually counted — present + half + absent. Leave and rest days are excluded
 * from the denominator rather than scored as absences, which is why someone on
 * approved leave does not watch their attendance percentage fall.
 *
 * Kept identical to the web deliberately: two different numbers for "your
 * attendance this month" on two screens of the same product is worse than
 * either number alone.
 */
export function monthStats(rows: Attendance[]): {
  present: number
  half: number
  absent: number
  onLeave: number
  hours: number
  rate: number
} {
  const prefix = localDateKey().slice(0, 7)
  const inMonth = rows.filter((a) => a.date.startsWith(prefix))

  const present = inMonth.filter((a) => a.status === 'present').length
  const half = inMonth.filter((a) => a.status === 'half').length
  const absent = inMonth.filter((a) => a.status === 'absent').length
  const onLeave = inMonth.filter((a) => a.status === 'leave').length
  const minutes = inMonth.reduce((sum, a) => sum + (a.work_minutes || 0), 0)
  const counted = present + half + absent

  return {
    present,
    half,
    absent,
    onLeave,
    hours: minutes / 60,
    rate: counted === 0 ? 0 : ((present + half * 0.5) / counted) * 100,
  }
}

// ── Announcements and notifications ────────────────────────────────────────

export type Priority = 'low' | 'normal' | 'high'

export type Announcement = {
  id: string
  title: string
  description: string
  priority: Priority
  published_at: string
  expires_at: string | null
}

/**
 * Company-wide posts from HR.
 *
 * No date filtering here on purpose: the RLS policy already restricts SELECT to
 * rows that are published and not expired. Repeating that as a client filter
 * would be a second place for the rule to live, and the two would eventually
 * disagree.
 */
export async function getAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await requireSupabase()
    .from('announcements')
    .select('id, title, description, priority, published_at, expires_at')
    .order('published_at', { ascending: false })
  if (error) throw error
  return (data as Announcement[]) ?? []
}

export type Notification = {
  id: string
  title: string
  body: string | null
  kind: string
  read_at: string | null
  created_at: string
}

/**
 * The caller's own notifications.
 *
 * `recipient_id` is filtered by RLS *and* by the web app explicitly — defence
 * in depth, so a policy widened later cannot put the whole company's feed in
 * one person's bell. The same reasoning applies here, but the filter would need
 * the auth uid; RLS alone is doing it, which is the boundary that matters.
 */
export async function getNotifications(limit = 50): Promise<Notification[]> {
  const { data, error } = await requireSupabase()
    .from('notifications')
    .select('id, title, body, kind, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as Notification[]) ?? []
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Relative time — "3h ago". Falls back to a date beyond a week. */
export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })
}
