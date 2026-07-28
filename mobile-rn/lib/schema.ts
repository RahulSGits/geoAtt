/**
 * The geoAtt data model, on Firestore.
 *
 * These are the same nine tables the website has in Postgres — profiles,
 * employees, attendance, leaves, announcements, notifications, reward_events,
 * shifts, sites — with the same field names and the same value sets, so the two
 * models can be reasoned about together and data could be moved between them.
 *
 * Field names stay snake_case on purpose. They match
 * `frontend/src/lib/types.ts` exactly; renaming them to camelCase would make
 * every comparison against the web app a translation exercise.
 *
 * Four things Postgres did that Firestore cannot, and what replaces them:
 *
 *  1. `unique (employee_id, date)` on attendance → encoded in the document ID
 *     via `attendanceId()`. Firestore has no unique constraint, but a
 *     deterministic ID makes a duplicate day a same-document write instead of a
 *     second row.
 *  2. Foreign keys → plain ID strings. Nothing cascades; deletes must clean up
 *     their own children.
 *  3. The `compute_attendance_status` trigger → must run in application code or
 *     a Cloud Function. Nothing here computes it for you.
 *  4. Enums → union types below, enforced by security rules rather than by the
 *     database.
 *
 * Timestamps are ISO 8601 strings and dates are `YYYY-MM-DD`, matching the web
 * types rather than Firestore's native Timestamp — same reason as the naming.
 */

// ── enums, mirroring the Postgres types ────────────────────────────────────
export type Role = 'admin' | 'hr' | 'employee'

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'half'
  | 'late'
  | 'leave'
  | 'pending'
  | 'off'

export type LeaveStatus = 'pending' | 'approved' | 'rejected'
export type Priority = 'low' | 'normal' | 'high'
export type SiteKind = 'office' | 'remote' | 'hybrid'
export type WorkMode = 'on_site' | 'remote' | 'hybrid'
export type RecheckinStatus = 'none' | 'requested' | 'approved' | 'denied'

// ── collections ────────────────────────────────────────────────────────────
export const COLLECTIONS = {
  profiles: 'profiles',
  employees: 'employees',
  attendance: 'attendance',
  leaves: 'leaves',
  announcements: 'announcements',
  notifications: 'notifications',
  rewardEvents: 'reward_events',
  shifts: 'shifts',
  sites: 'sites',
} as const

/** `profiles/{uid}` — the document ID is the Firebase Auth UID. */
export interface Profile {
  id: string
  full_name: string
  email: string
  role: Role
  phone: string | null
  department: string | null
  designation: string | null
  profile_image: string | null
  account_status: string | null
  password_created: boolean | null
  password_reset_allowed: boolean | null
  last_login_at: string | null
  login_count: number
  created_at: string
}

export interface Site {
  id: string
  name: string
  address: string | null
  kind: SiteKind
  /** Null for a remote site — there is no fixed place to fence. */
  latitude: number | null
  longitude: number | null
  radius_m: number
  is_active: boolean
  created_at: string
}

export interface Shift {
  id: string
  name: string
  /** `HH:MM:SS` in the site's local time. */
  start_time: string
  end_time: string
  grace_minutes: number
  full_day_minutes: number
  half_day_minutes: number
  /** ISO weekday numbers, 1 = Monday .. 7 = Sunday. */
  work_days: number[]
  work_mode: WorkMode
  is_active: boolean
  created_at: string
}

export interface Employee {
  id: string
  /** Auth UID — the link to `profiles/{uid}`. */
  user_id: string
  /** Human-facing code, `EMP-0001`. Unique; Postgres had a sequence for it. */
  employee_id: string
  full_name: string
  email: string
  phone: string | null
  department: string | null
  designation: string | null
  joining_date: string | null
  gender: string | null
  address: string | null
  status: string
  profile_image: string | null
  site_id: string | null
  shift_id: string | null
  /** One 128-float descriptor per enrolled pose. */
  face_descriptor: number[][] | null
  face_enrolled_at: string | null
  face_enroll_attempts: number
  face_enroll_granted_at: string | null
  face_enroll_granted_by: string | null
  reward_points: number
  created_at: string
}

export interface Attendance {
  id: string
  employee_id: string
  work_mode: WorkMode
  recheckin_status: RecheckinStatus
  recheckin_requested_at: string | null
  recheckin_note: string | null
  check_in: string | null
  check_out: string | null
  /** `YYYY-MM-DD`. Part of the document ID — see `attendanceId()`. */
  date: string
  status: AttendanceStatus
  site_id: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_accuracy_m: number | null
  check_out_lat: number | null
  check_out_lng: number | null
  check_in_selfie: string | null
  face_match_score: number | null
  work_minutes: number
  is_late: boolean
  accumulated_minutes: number
  session_count: number
  manual_override: boolean
  notes: string | null
  created_at: string
}

export interface Leave {
  id: string
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  reason: string | null
  status: LeaveStatus
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

export interface Announcement {
  id: string
  title: string
  description: string
  priority: Priority
  created_by: string | null
  created_at: string
}

export interface Notification {
  id: string
  recipient_id: string
  title: string
  body: string | null
  /** Free-form tag, e.g. 'leave' | 'attendance' | 'announcement'. */
  kind: string
  read_at: string | null
  created_at: string
}

export interface RewardEvent {
  id: string
  employee_id: string
  points: number
  reason: string
  /** `YYYY-MM-DD` the points were earned for. */
  date: string
  created_at: string
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Deterministic attendance document ID.
 *
 * Postgres enforced one row per employee per day with `unique (employee_id,
 * date)`. Firestore has no equivalent, so the pair becomes the key: a second
 * check-in for the same day overwrites rather than silently creating a
 * duplicate that would double-count worked minutes.
 */
export function attendanceId(employeeId: string, date: string): string {
  return `${employeeId}_${date}`
}

/** `EMP-0001` from a sequence number, matching the Postgres format. */
export function formatEmployeeCode(n: number): string {
  return `EMP-${String(n).padStart(4, '0')}`
}

/** Points for an on-time, in-geofence check-in. */
export const PUNCTUAL_POINTS = 3
/** Balance at which a reward can be claimed. */
export const REWARD_GOAL = 1000
/** Face registration is one-shot; a second needs an explicit HR grant. */
export const MAX_FACE_ENROLL_ATTEMPTS = 1

/** Admin is a superset of HR, exactly as `is_hr()` behaves in Postgres. */
export function roleSatisfies(actual: Role | undefined, required: Role): boolean {
  if (!actual) return false
  if (required === 'employee') return actual === 'employee'
  if (required === 'hr') return actual === 'hr' || actual === 'admin'
  return actual === 'admin'
}
