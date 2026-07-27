'use client'

import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import {
  Building2,
  CalendarCheck,
  CalendarRange,
  Clock,
  LayoutDashboard,
  MapPin,
  Megaphone,
  Activity,
  LogIn,
  ScanFace,
  TrendingUp,
  Shield,
  User,
  UserCheck,
  Wrench,
  Users,
} from 'lucide-react'
import DashboardShell, {
  type NavItem,
  type Notification,
  type UserProfile,
} from '@/components/DashboardShell'
import LiveClock from '@/components/LiveClock'
import SetupGuide from '@/components/SetupGuide'
import { useRealtimeNotifications } from '@/lib/useRealtimeNotifications'
import ChangePassword from '@/components/ChangePassword'
import ProfilePicture from '@/components/ProfilePicture'
import DiagnosticsSection, { type DiagnosticsData } from './sections/DiagnosticsSection'
import {
  AttendanceTrend,
  DepartmentBars,
  StatusDonut,
} from '@/components/charts/LazyCharts'
import {
  Alert,
  Avatar,
  EmptyState,
  PageHeader,
  Panel,
  Pill,
  StatCard,
  StatusBadge,
  staggerContainer,
} from '@/components/ui'
import { useToast } from '@/components/Toast'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui'
import { updateOwnProfile } from './actions'
import { formatDateTime, formatTime, localDateKey, relativeTime } from '@/lib/format'
import type {
  Announcement,
  AttendanceStatus,
  AttendanceWithEmployee,
  EmployeeWithAssignment,
  LeaveWithEmployee,
  LoginStatsRow,
  RecentLogin,
  Shift,
  Site,
} from '@/lib/types'
import EmployeesSection from './sections/EmployeesSection'
import AttendanceSection from './sections/AttendanceSection'
import LeavesSection from './sections/LeavesSection'
import AnnouncementsSection from './sections/AnnouncementsSection'
import SitesSection from './sections/SitesSection'
import ShiftsSection from './sections/ShiftsSection'
import MembersSection from './sections/MembersSection'

export default function HrDashboardClient({
  userProfile,
  myProfile,
  employees,
  attendance,
  leaves,
  announcements,
  sites,
  shifts,
  loadError,
  needsSetup,
  isAdmin,
  loginStats,
  recentLogins,
  statsUnavailable,
  setupSql,
  diagnostics,
}: {
  userProfile: UserProfile
  myProfile: {
    name: string
    email: string
    phone: string | null
    department: string | null
    designation: string | null
    role: string
    firstLogin: boolean
    /** Signed URL for their profile picture, resolved on the server. */
    avatarUrl?: string | null
  }
  employees: EmployeeWithAssignment[]
  attendance: AttendanceWithEmployee[]
  leaves: LeaveWithEmployee[]
  announcements: Announcement[]
  sites: Site[]
  shifts: Shift[]
  loadError: string | null
  needsSetup: boolean
  isAdmin: boolean
  loginStats: LoginStatsRow[]
  recentLogins: RecentLogin[]
  statsUnavailable: boolean
  setupSql: {
    migration: string | null
    repair: string | null
    loginTracking: string | null
    applyStep1: string | null
    applyStep2: string | null
    demoRoles: string | null
  }
  diagnostics: DiagnosticsData
}) {
  const [active, setActive] = useState('overview')

  const today = localDateKey()
  const todayRecords = useMemo(
    () => attendance.filter((a) => a.date === today),
    [attendance, today],
  )

  const pendingLeaves = leaves.filter((l) => l.status === 'pending').length

  /** Portal-wide sign-in counters, summed across roles. */
  const portal = useMemo(() => {
    const sum = (key: keyof LoginStatsRow) =>
      loginStats.reduce((acc, row) => acc + Number(row[key] ?? 0), 0)
    const accounts = sum('total')
    const ever = sum('ever_logged_in')
    return {
      accounts,
      everLoggedIn: ever,
      neverLoggedIn: sum('never_logged_in'),
      today: sum('active_today'),
      week: sum('active_7d'),
      adoption: accounts === 0 ? 0 : (ever / accounts) * 100,
    }
  }, [loginStats])

  const stats = useMemo(() => {
    const activeStaff = employees.filter((e) => e.status === 'active').length
    const presentToday = todayRecords.filter(
      (a) => a.status === 'present' || a.status === 'half' || a.status === 'pending',
    ).length
    const lateToday = todayRecords.filter((a) => a.is_late).length
    const enrolled = employees.filter((e) => e.face_descriptor).length

    return {
      headcount: employees.length,
      activeStaff,
      presentToday,
      lateToday,
      enrolled,
      presentRate: activeStaff === 0 ? 0 : (presentToday / activeStaff) * 100,
    }
  }, [employees, todayRecords])

  /** Last 14 days of present/absent/late counts for the trend chart. */
  const trend = useMemo(() => {
    const days: { date: string; present: number; absent: number; late: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = localDateKey(d)
      const rows = attendance.filter((a) => a.date === key)
      days.push({
        date: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        present: rows.filter((a) => a.status === 'present' || a.status === 'half').length,
        absent: rows.filter((a) => a.status === 'absent').length,
        late: rows.filter((a) => a.is_late).length,
      })
    }
    return days
  }, [attendance])

  const departmentData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of employees) {
      const key = e.department?.trim() || 'Unassigned'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts, ([department, headcount]) => ({ department, headcount }))
      .sort((a, b) => b.headcount - a.headcount)
      .slice(0, 8)
  }, [employees])

  const statusData = useMemo(() => {
    const counts = new Map<AttendanceStatus, number>()
    for (const a of attendance) counts.set(a.status, (counts.get(a.status) ?? 0) + 1)
    return Array.from(counts, ([status, count]) => ({ status, count })).sort(
      (a, b) => b.count - a.count,
    )
  }, [attendance])

  const derivedNotifications = useMemo<Notification[]>(() => {
    const leaveNotifs = leaves
      .filter((l) => l.status === 'pending')
      .slice(0, 6)
      .map((l) => ({
        id: `leave-${l.id}`,
        title: 'Leave request awaiting approval',
        body: `${l.employees?.full_name ?? 'An employee'} requested ${l.leave_type} leave`,
        createdAt: l.created_at,
      }))

    const unenrolled = employees.filter((e) => !e.face_descriptor && e.status === 'active')
    const enrollNotif: Notification[] =
      unenrolled.length > 0
        ? [
            {
              id: 'face-pending',
              title: `${unenrolled.length} employee${unenrolled.length === 1 ? '' : 's'} not enrolled`,
              body: 'They cannot check in until they register their face.',
              createdAt: new Date().toISOString(),
            },
          ]
        : []

    return [...leaveNotifs, ...enrollNotif].slice(0, 8)
  }, [leaves, employees])

  // Real notifications from the database (role changes, requests employees
  // submit, anything another admin did) on top of the derived to-do items above.
  const live = useRealtimeNotifications(userProfile.id)
  const notifications = useMemo<Notification[]>(
    () => [...live.notifications, ...derivedNotifications].slice(0, 30),
    [live.notifications, derivedNotifications],
  )

  const nav: NavItem[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'employees', label: 'Employees', icon: Users },
    { key: 'attendance', label: 'Attendance', icon: CalendarRange },
    { key: 'leaves', label: 'Leave requests', icon: CalendarCheck, badge: pendingLeaves },
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
    { key: 'members', label: 'Members & access', icon: Shield },
    { key: 'sites', label: 'Work sites', icon: MapPin },
    { key: 'shifts', label: 'Shifts', icon: Clock },
    // Admin-only tiers: role assignment, sign-in activity, diagnostics.
    ...(isAdmin
      ? ([
          { key: 'signins', label: 'Sign-in activity', icon: Activity },
          { key: 'diagnostics', label: 'Diagnostics', icon: Wrench },
        ] as NavItem[])
      : []),
    { key: 'profile', label: 'My Profile', icon: User },
  ]

  if (needsSetup) {
    return (
      <DashboardShell
        nav={nav}
        active={active}
        onSelect={setActive}
        userProfile={userProfile}
        notifications={[]}
      >
        <SetupGuide />
      </DashboardShell>
    )
  }

  return (
    <DashboardShell
      nav={nav}
      active={active}
      onSelect={setActive}
      userProfile={userProfile}
      notifications={notifications}
      unseenCount={live.unseenCount}
      onNotificationsOpen={live.markAllSeen}
    >
      {loadError && (
        <div className="mb-4">
          <Alert tone="error">Data could not be loaded: {loadError}</Alert>
        </div>
      )}

      {active === 'overview' && (
        <>
          <PageHeader title="Overview" subtitle={<LiveClock />} />

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <StatCard
              label="Headcount"
              value={stats.headcount}
              icon={<Users size={17} />}
              tone="var(--primary)"
              sub={`${stats.activeStaff} active`}
            />
            <StatCard
              label="In today"
              value={stats.presentToday}
              icon={<UserCheck size={17} />}
              tone="var(--success)"
              // "0" on its own reads as a failure; "0 of 12 · 0 late" says how
              // big the day actually is. Matches the Face enrolled card.
              sub={`of ${stats.activeStaff} active · ${stats.lateToday} late`}
            />
            <StatCard
              label="Attendance rate"
              value={stats.presentRate}
              decimals={0}
              suffix="%"
              icon={<TrendingUp size={17} />}
              tone="var(--accent)"
              sub="of active staff"
            />
            <StatCard
              label="Face enrolled"
              value={stats.enrolled}
              icon={<ScanFace size={17} />}
              tone="var(--info)"
              sub={`of ${stats.headcount} employees`}
            />
            <StatCard
              label="Members signed in"
              value={portal.everLoggedIn}
              icon={<LogIn size={17} />}
              tone="#7c3aed"
              sub={`of ${portal.accounts} portal accounts`}
            />
            <StatCard
              label="Signed in today"
              value={portal.today}
              icon={<Activity size={17} />}
              tone="var(--chart-2)"
              sub={`${portal.week} in the last 7 days`}
            />
          </motion.div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Panel
              title="Attendance trend"
              subtitle="Last 14 days"
              className="xl:col-span-2"
            >
              <AttendanceTrend data={trend} />
            </Panel>

            <Panel title="Status mix" subtitle="All loaded records">
              <StatusDonut data={statusData} />
            </Panel>

            <Panel title="Headcount by department" className="xl:col-span-1">
              <DepartmentBars data={departmentData} />
            </Panel>

            <Panel title="Today's activity" className="xl:col-span-2" bodyClassName="p-0">
              {todayRecords.length === 0 ? (
                <EmptyState
                  icon={<CalendarRange size={30} />}
                  title="Nobody has checked in yet"
                  description="Check-ins recorded today will appear here in real time."
                />
              ) : (
                <div className="table-wrap max-h-[320px] overflow-y-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Status</th>
                        <th>In</th>
                        <th>Out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todayRecords.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <div className="flex items-center gap-2.5">
                              <Avatar name={a.employees?.full_name ?? '?'} size={28} />
                              <span className="truncate font-medium">
                                {a.employees?.full_name ?? 'Unknown'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <StatusBadge status={a.status} />
                          </td>
                          <td className="tabular-nums">{formatTime(a.check_in)}</td>
                          <td className="tabular-nums">{formatTime(a.check_out)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel
              title="Pending approvals"
              action={
                pendingLeaves > 0 && (
                  <button
                    onClick={() => setActive('leaves')}
                    className="text-xs font-medium text-[var(--primary)] hover:underline cursor-pointer"
                  >
                    Review
                  </button>
                )
              }
              bodyClassName="p-0"
            >
              {pendingLeaves === 0 ? (
                <EmptyState
                  icon={<CalendarCheck size={28} />}
                  title="Nothing to approve"
                />
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {leaves
                    .filter((l) => l.status === 'pending')
                    .slice(0, 5)
                    .map((l) => (
                      <li key={l.id} className="flex items-center gap-2.5 px-4 py-2.5">
                        <Avatar name={l.employees?.full_name ?? '?'} size={28} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {l.employees?.full_name ?? 'Unknown'}
                          </div>
                          <div className="muted truncate text-xs">
                            {l.leave_type} · {relativeTime(l.created_at)}
                          </div>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>

            <Panel title="Infrastructure" bodyClassName="p-4">
              <dl className="space-y-3 text-sm">
                <InfraRow
                  icon={<MapPin size={15} />}
                  label="Work sites"
                  value={`${sites.length} configured`}
                  onClick={() => setActive('sites')}
                />
                <InfraRow
                  icon={<Clock size={15} />}
                  label="Shifts"
                  value={`${shifts.length} defined`}
                  onClick={() => setActive('shifts')}
                />
                <InfraRow
                  icon={<Building2 size={15} />}
                  label="Departments"
                  value={`${departmentData.length} in use`}
                />
                <InfraRow
                  icon={<Megaphone size={15} />}
                  label="Announcements"
                  value={`${announcements.length} live`}
                  onClick={() => setActive('announcements')}
                />
              </dl>
            </Panel>
          </div>
        </>
      )}

      {active === 'employees' && (
        <EmployeesSection employees={employees} sites={sites} shifts={shifts} />
      )}
      {active === 'attendance' && (
        <AttendanceSection attendance={attendance} employees={employees} />
      )}
      {active === 'leaves' && <LeavesSection leaves={leaves} />}
      {active === 'announcements' && <AnnouncementsSection announcements={announcements} />}
      {active === 'sites' && <SitesSection sites={sites} />}
      {active === 'shifts' && <ShiftsSection shifts={shifts} />}

      {active === 'signins' && (
        <>
          <PageHeader
            title="Sign-in activity"
            subtitle={`${portal.everLoggedIn} of ${portal.accounts} accounts have signed in`}
          />

          {statsUnavailable && (
            <div className="mb-4">
              <Alert tone="warning">
                Sign-in tracking isn&apos;t installed yet. Run the login-tracking SQL from
                the Diagnostics tab — counts stay at zero until then.
              </Alert>
            </div>
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Portal accounts" value={portal.accounts} icon={<Users size={17} />} tone="var(--primary)" />
            <StatCard label="Ever signed in" value={portal.everLoggedIn} icon={<LogIn size={17} />} tone="#7c3aed" />
            <StatCard label="Never signed in" value={portal.neverLoggedIn} icon={<Users size={17} />} tone="var(--warning)" />
            <StatCard label="Adoption" value={portal.adoption} decimals={0} suffix="%" icon={<TrendingUp size={17} />} tone="var(--accent)" />
          </div>

          <Panel title="Recent sign-ins" bodyClassName="p-0">
            {recentLogins.length === 0 ? (
              <EmptyState
                icon={<Activity size={30} />}
                title="No sign-ins recorded"
                description="Sign-ins are counted from the moment the tracking SQL is applied."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Role</th>
                      <th>Last sign-in</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLogins.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={row.full_name || row.email} size={30} />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{row.full_name || '—'}</div>
                              <div className="muted truncate text-xs">{row.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Pill tone={row.role === 'hr' ? '#2563eb' : '#059669'}>{row.role}</Pill>
                        </td>
                        <td className="whitespace-nowrap">
                          {formatDateTime(row.last_login_at)}
                          <div className="muted text-xs">{relativeTime(row.last_login_at)}</div>
                        </td>
                        <td className="tabular-nums">{row.login_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {active === 'diagnostics' && (
        <DiagnosticsSection sql={setupSql} diagnostics={diagnostics} />
      )}

      {active === 'members' && <MembersSection isAdmin={isAdmin} />}

      {active === 'profile' && <MyProfileSection profile={myProfile} />}

    </DashboardShell>
  )
}

function InfraRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onClick?: () => void
}) {
  const content = (
    <>
      <dt className="muted flex items-center gap-2">
        {icon}
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </>
  )

  if (!onClick) {
    return <div className="flex items-center justify-between gap-2">{content}</div>
  }

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-[var(--surface-2)] cursor-pointer"
    >
      {content}
    </button>
  )
}

function MyProfileSection({
  profile,
}: {
  profile: {
    name: string
    email: string
    phone: string | null
    department: string | null
    designation: string | null
    role: string
    firstLogin: boolean
    /** Signed URL for their profile picture, resolved on the server. */
    avatarUrl?: string | null
  }
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await updateOwnProfile(new FormData(e.currentTarget))
    if (res.ok) {
      toast.success('Profile updated.')
      router.refresh()
    } else {
      setError(res.error)
    }
    setSaving(false)
  }

  return (
    <>
      <PageHeader title="My profile" subtitle="Your administrator account details" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Profile picture">
          <ProfilePicture name={profile.name} initialUrl={profile.avatarUrl ?? null} />
        </Panel>

        <Panel title="Details">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label" htmlFor="hp-name">Full name</label>
              <input id="hp-name" name="fullName" required defaultValue={profile.name} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="hp-email">Email</label>
              <input id="hp-email" value={profile.email} readOnly disabled className="field" />
              <p className="muted mt-1 text-xs">Your sign-in address cannot be changed here.</p>
            </div>
            <div>
              <label className="label" htmlFor="hp-phone">Phone</label>
              <input id="hp-phone" name="phone" type="tel" defaultValue={profile.phone ?? ''} className="field" />
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving && <Spinner size={16} />} Save changes
            </button>
          </form>
        </Panel>

        <div className="space-y-4">
          <ChangePassword firstLogin={profile.firstLogin} />

          <Panel title="Account">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="muted mb-0.5 text-xs">Role</dt>
              <dd className="font-medium capitalize">{profile.role}</dd>
            </div>
            <div>
              <dt className="muted mb-0.5 text-xs">Department</dt>
              <dd className="font-medium">{profile.department || '—'}</dd>
            </div>
            <div>
              <dt className="muted mb-0.5 text-xs">Designation</dt>
              <dd className="font-medium">{profile.designation || '—'}</dd>
            </div>
          </dl>
          </Panel>
        </div>
      </div>
    </>
  )
}
