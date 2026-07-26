import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getSession } from '@/lib/auth'
import { localDateKey } from '@/lib/format'
import { usingSandboxSender } from '@/lib/email'
import HrDashboardClient from './HrDashboardClient'
import { describeServiceKey, serviceKeyState, serviceKeyUsable } from '@/lib/serviceKey'
import type {
  Announcement,
  AttendanceWithEmployee,
  Employee,
  EmployeeWithAssignment,
  LeaveWithEmployee,
  LoginStatsRow,
  RecentLogin,
  Shift,
  Site,
} from '@/lib/types'

export const dynamic = 'force-dynamic'

/** Days of attendance history loaded for the console's charts and tables. */
const HISTORY_DAYS = 60

/**
 * Postgres/PostgREST codes that mean "the migration hasn't been applied",
 * as opposed to an ordinary query failure.
 *
 * 42P17 — infinite recursion in an RLS policy (the un-fixed profiles policy).
 * 42P01 / PGRST205 — relation or table missing from the schema cache.
 */
const SETUP_CODES = new Set(['42P17', '42P01', 'PGRST205', 'PGRST200'])

function isSetupError(error: { code?: string } | null): boolean {
  return Boolean(error?.code && SETUP_CODES.has(error.code))
}

/** SQL scripts, read only for the Diagnostics tab. */
async function readSetupSql() {
  const root = path.join(process.cwd(), '..', 'supabase')
  const read = async (relative: string) => {
    try {
      return await readFile(path.join(root, relative), 'utf8')
    } catch {
      return null
    }
  }
  const [migration, repair, loginTracking, applyStep1, applyStep2] = await Promise.all([
    read('migrations/20260721000000_finatt_full_schema.sql'),
    read('repair_broken_logins.sql'),
    read('migrations/20260723000000_login_tracking.sql'),
    read('APPLY_STEP_1.sql'),
    read('APPLY_STEP_2.sql'),
  ])
  const demoRoles = await read('seed_demo_roles.sql')
  return { migration, repair, loginTracking, applyStep1, applyStep2, demoRoles }
}

export default async function HrPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'hr' && session.role !== 'admin') redirect('/employee')

  const supabase = await createClient()

  const since = new Date()
  since.setDate(since.getDate() - HISTORY_DAYS)

  // Fetched separately rather than with `employees(*, sites(*), shifts(*))`.
  // An embedded select fails wholesale if any one relation is missing from the
  // schema cache, so a single absent table blanked the entire console. Joining
  // in memory means each dataset degrades on its own.
  const [employeesRes, sitesRes, shiftsRes, attendanceRes, leavesRes, announcementsRes] =
    await Promise.all([
      supabase.from('employees').select('*').order('created_at', { ascending: false }),
      supabase.from('sites').select('*').order('created_at'),
      supabase.from('shifts').select('*').order('start_time'),
      supabase
        .from('attendance')
        .select('*, employees(id, full_name, employee_id, department)')
        .gte('date', localDateKey(since))
        .order('date', { ascending: false }),
      supabase
        .from('leaves')
        .select('*, employees(id, full_name, employee_id, department)')
        .order('created_at', { ascending: false }),
      supabase.from('announcements').select('*').order('created_at', { ascending: false }),
    ])

  // Login stats live behind RPCs added by a later migration; their absence is a
  // "not installed yet" state, not an error the user can act on differently.
  const [statsRes, recentRes, adminsRes] = await Promise.all([
    supabase.rpc('portal_login_stats'),
    supabase.rpc('recent_logins', { limit_count: 25 }),
    // Administrators are staff, not workforce: they have no shift, no site and
    // never check in. A stray employees row for one would inflate the headcount
    // and every attendance percentage derived from it.
    supabase.from('profiles').select('id').eq('role', 'admin'),
  ])
  const statsUnavailable = /portal_login_stats|recent_logins/i.test(
    statsRes.error?.message ?? '',
  )

  const sites = (sitesRes.data ?? []) as Site[]
  const shifts = (shiftsRes.data ?? []) as Shift[]

  const siteById = new Map(sites.map((s) => [s.id, s]))
  const shiftById = new Map(shifts.map((s) => [s.id, s]))

  const adminUserIds = new Set(
    ((adminsRes.data ?? []) as { id: string }[]).map((p) => p.id),
  )

  const employees: EmployeeWithAssignment[] = ((employeesRes.data ?? []) as Employee[])
    .filter((employee) => !employee.user_id || !adminUserIds.has(employee.user_id))
    .map((employee) => ({
      ...employee,
      sites: employee.site_id ? (siteById.get(employee.site_id) ?? null) : null,
      shifts: employee.shift_id ? (shiftById.get(employee.shift_id) ?? null) : null,
    }))

  // Only the roster query decides whether this is a setup problem — the others
  // may legitimately be empty on a fresh install.
  const needsSetup =
    isSetupError(employeesRes.error) ||
    isSetupError(sitesRes.error) ||
    isSetupError(shiftsRes.error)

  const loadError = needsSetup
    ? null
    : (employeesRes.error?.message ??
      attendanceRes.error?.message ??
      leavesRes.error?.message ??
      null)

  const setupSql = await readSetupSql()
  return (
    <HrDashboardClient
      userProfile={{ id: session.userId, name: session.name, role: session.role }}
      myProfile={{
        name: session.name,
        email: session.email,
        phone: session.profile?.phone ?? null,
        department: session.profile?.department ?? null,
        designation: session.profile?.designation ?? null,
        role: session.role,
        firstLogin: session.profile?.password_created === false,
      }}
      employees={employees}
      attendance={(attendanceRes.data ?? []) as AttendanceWithEmployee[]}
      leaves={(leavesRes.data ?? []) as LeaveWithEmployee[]}
      announcements={(announcementsRes.data ?? []) as Announcement[]}
      sites={sites}
      shifts={shifts}
      loadError={loadError}
      needsSetup={needsSetup}
      isAdmin={session.role === 'admin'}
      loginStats={(statsRes.data ?? []) as LoginStatsRow[]}
      recentLogins={(recentRes.data ?? []) as RecentLogin[]}
      statsUnavailable={statsUnavailable}
      setupSql={setupSql}
      diagnostics={{
        serviceKey: serviceKeyUsable(),
        serviceKeyDetail: describeServiceKey(serviceKeyState()),
        email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
        sandboxSender: usingSandboxSender(),
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        aiModel: process.env.GEMINI_MODEL || 'gemini-flash-latest (auto)',
        aiConfigured: Boolean(process.env.GEMINI_API_KEY),
      }}
    />
  )
}
