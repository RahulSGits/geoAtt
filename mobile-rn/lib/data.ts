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

export async function getHistory(employeeId: string, days = 14): Promise<Attendance[]> {
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
