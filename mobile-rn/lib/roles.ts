/**
 * Role model, ported from the web app's `lib/auth.ts`.
 *
 * The asymmetry here is load-bearing and easy to "fix" into a bug:
 *
 *   admin ⊇ hr        an administrator may do anything HR may do
 *   employee is EXACT an administrator is NOT an employee
 *
 * That second rule is why an admin has no `employees` row, and why
 * employee-only actions — check-in, leave — correctly reject them. Postgres
 * enforces the same shape: `is_hr()` returns true for admin, while
 * `current_employee_id()` returns null for anyone without an employees row.
 *
 * If you ever make `employee` inclusive to "let admins test check-in", you
 * break the geofence and face-match guarantees for the whole company.
 */
export type Role = 'admin' | 'hr' | 'employee'

export function roleSatisfies(held: Role | null | undefined, needed: Role): boolean {
  if (!held) return false
  if (needed === 'employee') return held === 'employee'
  if (needed === 'hr') return held === 'hr' || held === 'admin'
  return held === 'admin'
}

/**
 * Where a role lands after sign-in.
 *
 * The mobile app is the employee-facing surface: check-in needs a camera and a
 * GPS fix, which is the phone's job. The HR and admin consoles are dense
 * table-and-chart work that belongs on the web, so those roles get a screen
 * that says so and links out rather than a half-built console that would be
 * worse than the real one.
 */
export function homeFor(role: Role | null | undefined): '/home' | '/console' {
  return roleSatisfies(role, 'hr') ? '/console' : '/home'
}

export const roleLabel: Record<Role, string> = {
  admin: 'Administrator',
  hr: 'HR',
  employee: 'Employee',
}
