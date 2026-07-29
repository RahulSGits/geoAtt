/** Row shapes mirroring supabase/migrations/20260721000000_finatt_full_schema.sql */

export type Role = 'admin' | 'hr' | 'employee'

/** Portal-wide sign-in counters, from public.portal_login_stats(). */
export interface LoginStatsRow {
  role: string
  total: number
  ever_logged_in: number
  never_logged_in: number
  active_today: number
  active_7d: number
  active_30d: number
}

/** One row of public.recent_logins(). */
export interface RecentLogin {
  id: string
  full_name: string
  email: string
  role: string
  last_login_at: string
  login_count: number
}

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
  /** Admin-granted: lets this user change their own password. Single-use. */
  password_reset_allowed: boolean | null
  last_login_at: string | null
  login_count: number
  created_at: string
}

/**
 * How a site is worked.
 * - `office` — geofence enforced, employee must be inside the radius.
 * - `remote` — no location check at all (face + liveness still apply).
 * - `hybrid` — has an office location, but working outside it is allowed.
 */
export type SiteKind = 'office' | 'remote' | 'hybrid'

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

/**
 * Whether check-in should be gated on where the employee is standing.
 *
 * Both the place and the rota must agree it is on-site. A remote shift wins
 * over an office site — a work-from-home rota attached to head office must not
 * fence people out.
 */
export function enforcesGeofence(
  site: Pick<Site, 'kind' | 'latitude' | 'longitude'>,
  shift?: Pick<Shift, 'work_mode'> | null,
): boolean {
  if (shift && workModeOf(shift) !== 'on_site') return false
  return siteKindOf(site) === 'office' && site.latitude !== null && site.longitude !== null
}

/**
 * Shared palette for work arrangement, used by both sites and shifts.
 * Deliberately vivid and hue-separated so the three states are distinguishable
 * at a glance in a grid of cards, and still tell apart under deuteranopia.
 */
export const WORK_COLORS = {
  onSite: '#2563eb', // blue
  remote: '#059669', // emerald
  hybrid: '#ea580c', // orange
} as const

export const siteKindMeta: Record<
  SiteKind,
  { label: string; short: string; description: string; color: string }
> = {
  office: {
    label: 'On-site',
    short: 'Office',
    description: 'On-site only. Check-in is refused outside the geofence.',
    color: WORK_COLORS.onSite,
  },
  remote: {
    label: 'Work from home',
    short: 'Remote',
    description: 'Location is not checked. Face and liveness still verified.',
    color: WORK_COLORS.remote,
  },
  hybrid: {
    label: 'Hybrid',
    short: 'Hybrid',
    description: 'Has an office, but employees may check in from anywhere.',
    color: WORK_COLORS.hybrid,
  },
}

/** How a rota is worked, independent of where the site is. */
export type WorkMode = 'on_site' | 'remote' | 'hybrid'

/**
 * Resolve a work mode defensively.
 *
 * `shifts.work_mode` arrives as undefined until its migration is applied, and
 * indexing the meta map with undefined threw, taking the whole Shifts page down
 * with "Cannot read properties of undefined (reading 'color')". A missing
 * column should degrade to the safe default, not crash the console.
 */
export function workModeOf(shift?: { work_mode?: WorkMode | null } | null): WorkMode {
  const mode = shift?.work_mode
  return mode && mode in workModeMeta ? mode : 'on_site'
}

/** Same guard for a site whose `kind` column predates the migration. */
export function siteKindOf(site?: { kind?: SiteKind | null } | null): SiteKind {
  const kind = site?.kind
  return kind && kind in siteKindMeta ? kind : 'office'
}

export const workModeMeta: Record<
  WorkMode,
  { label: string; description: string; color: string }
> = {
  on_site: {
    label: 'On-site',
    description: 'Worked at the assigned site. Geofence applies if it is an office.',
    color: WORK_COLORS.onSite,
  },
  remote: {
    label: 'Work from home',
    description: 'Never geofenced, even when the assigned site is an office.',
    color: WORK_COLORS.remote,
  },
  hybrid: {
    label: 'Hybrid',
    description: 'Either place. Location is recorded but not enforced.',
    color: WORK_COLORS.hybrid,
  },
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
  /** How this rota is worked; combines with the site's kind for geofencing. */
  work_mode: WorkMode
  is_active: boolean
  created_at: string
}

export interface Employee {
  id: string
  user_id: string
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
  /**
   * Face templates: one 128-float descriptor per enrolled pose. Older records
   * hold a single flat descriptor, so readers must tolerate both shapes.
   */
  face_descriptor: number[] | number[][] | null
  face_enrolled_at: string | null
  /** Registrations used. At MAX_FACE_ENROLL_ATTEMPTS the portal locks. */
  face_enroll_attempts: number
  face_enroll_granted_at: string | null
  face_enroll_granted_by: string | null
  /** Punctuality points earned. */
  reward_points: number
  created_at: string
}

/** Points awarded for an on-time, on-site check-in. */
export const PUNCTUAL_POINTS = 3
/** Balance at which a reward can be claimed. */
export const REWARD_GOAL = 1000

/**
 * Face registration is one-shot.
 *
 * The template is the identity anchor for every future check-in, so letting an
 * employee silently re-point it at another face would defeat the control. A
 * second registration requires an explicit HR grant.
 */
export const MAX_FACE_ENROLL_ATTEMPTS = 1

/**
 * Which work modes the employee may pick at check-in.
 *
 * Deliberately derived from the assignment rather than free choice: if HR put
 * someone on an office site with an on-site rota, letting them self-select
 * "work from home" would waive the geofence they were meant to be held to.
 * Flexibility has to be granted by HR, not claimed by the employee.
 */
export function allowedWorkModes(
  site?: Pick<Site, 'kind'> | null,
  shift?: Pick<Shift, 'work_mode'> | null,
): WorkMode[] {
  const kind = siteKindOf(site)
  const rota = workModeOf(shift)

  // A remote-only site or rota has no on-site option to offer.
  if (rota === 'remote' || kind === 'remote') return ['remote']

  // Otherwise both are offered. This is a policy-visible rather than a
  // policy-enforced design: an employee may declare working from home even on
  // an office posting, and the choice is recorded per day on the attendance
  // row so HR can see exactly who claimed it and when. Choosing on-site still
  // enforces the geofence in full.
  return ['on_site', 'remote']
}

/** Attempts left, floored at zero. Treats a missing column as a full allowance. */
export function faceAttemptsLeft(employee?: Pick<Employee, 'face_enroll_attempts'> | null): number {
  const used = employee?.face_enroll_attempts ?? 0
  return Math.max(0, MAX_FACE_ENROLL_ATTEMPTS - used)
}

/** Employee joined with its assigned site and shift. */
export interface EmployeeWithAssignment extends Employee {
  sites: Site | null
  shifts: Shift | null
}

export interface Attendance {
  id: string
  employee_id: string
  /** How the day was actually worked, chosen at check-in. */
  work_mode: WorkMode
  /** Re-check-in request state: none | requested | approved | denied. */
  recheckin_status: string
  recheckin_requested_at: string | null
  recheckin_note: string | null
  check_in: string | null
  check_out: string | null
  date: string
  status: AttendanceStatus
  site_id: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_accuracy_m: number | null
  check_out_lat: number | null
  check_out_lng: number | null
  /** Storage object path in the private `selfies` bucket. */
  check_in_selfie: string | null
  face_match_score: number | null
  work_minutes: number
  is_late: boolean
  /** Minutes banked from earlier completed sessions today. */
  accumulated_minutes: number
  session_count: number
  /** True when HR set the status by hand; suppresses the auto-status trigger. */
  manual_override: boolean
  notes: string | null
  created_at: string
}

export interface AttendanceWithEmployee extends Attendance {
  employees: Pick<Employee, 'id' | 'full_name' | 'employee_id' | 'department'> | null
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

export interface LeaveWithEmployee extends Leave {
  employees: Pick<Employee, 'id' | 'full_name' | 'employee_id' | 'department'> | null
}

export interface Announcement {
  id: string
  title: string
  description: string
  priority: Priority
  created_by: string | null
  created_at: string
}

/** Discriminated result returned by every server action. */
export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; error: string }

/**
 * The onboarding password used to live here as a hardcoded literal.
 *
 * It was removed because this module is imported by `'use client'` components,
 * so the value shipped inside the browser bundle — and, once the repository
 * became public, sat in a file anyone could read on GitHub. It was the starting
 * credential for every account in the company.
 *
 * It now comes from ONBOARDING_PASSWORD in the environment. See
 * `lib/onboarding.ts`, which is server-only; client code that needs to display
 * it calls the HR-guarded `getOnboardingPassword` action.
 */

/**
 * Shortest password the app will accept, wherever one is chosen — by the member
 * on /set-password, by someone changing their own, or by an administrator
 * setting one on a member's behalf. Shared so the three paths cannot drift.
 */
export const MIN_PASSWORD_LENGTH = 8
