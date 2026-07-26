'use client'

import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import {
  BadgeCheck,
  CalendarCheck,
  CalendarRange,
  Clock,
  Download,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Megaphone,
  ScanFace,
  Timer,
  TrendingUp,
  User,
} from 'lucide-react'
import DashboardShell, {
  type NavItem,
  type Notification,
  type UserProfile,
} from '@/components/DashboardShell'
import Modal from '@/components/Modal'
import FaceCheckIn, { type CheckInPayload } from '@/components/FaceCheckIn'
import AttendanceCalendar from '@/components/AttendanceCalendar'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import {
  Alert,
  EmptyState,
  LeaveBadge,
  PageHeader,
  Panel,
  PriorityBadge,
  Spinner,
  StatCard,
  StatusBadge,
  staggerContainer,
} from '@/components/ui'
import {
  daysBetween,
  downloadCsv,
  formatDate,
  formatDateTime,
  formatDuration,
  formatShiftTime,
  formatTime,
  localDateKey,
  relativeTime,
  toCsv,
  WEEKDAY_LABELS,
} from '@/lib/format'
import {
  allowedWorkModes,
  faceAttemptsLeft,
  PUNCTUAL_POINTS,
  REWARD_GOAL,
  MAX_FACE_ENROLL_ATTEMPTS,
  siteKindMeta,
  siteKindOf,
  workModeMeta,
  workModeOf,
} from '@/lib/types'
import type { Announcement, Attendance, Employee, Leave, Shift, Site } from '@/lib/types'
import { applyLeave, cancelLeave, checkIn, checkOut, enrollFace, requestRecheckin, updateMyProfile } from './actions'
import LiveClock from '@/components/LiveClock'
import ChangePassword from '@/components/ChangePassword'
import { useRealtimeNotifications } from '@/lib/useRealtimeNotifications'

const LEAVE_TYPES = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Work from home']

export default function EmployeeDashboardClient({
  userProfile,
  email,
  firstLogin,
  employee,
  site,
  shift,
  attendance,
  todayRecord,
  leaves,
  announcements,
}: {
  userProfile: UserProfile
  email: string
  firstLogin: boolean
  employee: Employee | null
  site: Site | null
  shift: Shift | null
  attendance: Attendance[]
  todayRecord: Attendance | null
  leaves: Leave[]
  announcements: Announcement[]
}) {
  const [active, setActive] = useState('overview')
  const [checkInOpen, setCheckInOpen] = useState(false)
  const [checkOutOpen, setCheckOutOpen] = useState(false)
  const [reward, setReward] = useState<number | null>(null)
  const [requestingRecheckin, setRequestingRecheckin] = useState(false)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const toast = useToast()
  const router = useRouter()

  const enrolled = Boolean(employee?.face_descriptor?.length)
  // Stored as one template per pose (or a single legacy array).
  const attemptsLeft = faceAttemptsLeft(employee)
  const workModes = useMemo(() => allowedWorkModes(site, shift), [site, shift])
  const enrollLocked = attemptsLeft === 0
  const checkedIn = Boolean(todayRecord?.check_in)
  const checkedOut = Boolean(todayRecord?.check_out)

  /* ── Derived stats for the current month ──────────────────────────────── */
  const monthStats = useMemo(() => {
    const prefix = localDateKey().slice(0, 7)
    const rows = attendance.filter((a) => a.date.startsWith(prefix))
    const present = rows.filter((a) => a.status === 'present').length
    const half = rows.filter((a) => a.status === 'half').length
    const absent = rows.filter((a) => a.status === 'absent').length
    const onLeave = rows.filter((a) => a.status === 'leave').length
    const minutes = rows.reduce((sum, a) => sum + (a.work_minutes || 0), 0)
    const counted = present + half + absent
    return {
      present,
      half,
      absent,
      onLeave,
      hours: minutes / 60,
      rate: counted === 0 ? 0 : ((present + half * 0.5) / counted) * 100,
    }
  }, [attendance])

  const pendingLeaves = leaves.filter((l) => l.status === 'pending').length

  const live = useRealtimeNotifications(userProfile.id)

  const derived = useMemo<Notification[]>(() => {
    const fromAnnouncements = announcements.slice(0, 5).map((a) => ({
      id: `ann-${a.id}`,
      title: a.title,
      body: a.description,
      createdAt: a.created_at,
    }))
    const fromLeaves = leaves
      .filter((l) => l.status !== 'pending' && l.decided_at)
      .slice(0, 5)
      .map((l) => ({
        id: `leave-${l.id}`,
        title: `Leave ${l.status}`,
        body: `${l.leave_type} leave from ${formatDate(l.start_date)} to ${formatDate(l.end_date)}`,
        createdAt: l.decided_at!,
      }))
    return [...fromLeaves, ...fromAnnouncements]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8)
  }, [announcements, leaves])

  // Prefer the realtime feed once it has anything; fall back to the derived
  // list so the bell is never empty before the notifications table is in use.
  const notifications = live.notifications.length > 0 ? live.notifications : derived

  const nav: NavItem[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'attendance', label: 'My Attendance', icon: CalendarRange },
    { key: 'leaves', label: 'My Leaves', icon: CalendarCheck, badge: pendingLeaves },
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
    { key: 'profile', label: 'My Profile', icon: User },
  ]

  /* ── Handlers ─────────────────────────────────────────────────────────── */

  async function handleEnroll(payload: CheckInPayload) {
    const fd = new FormData()
    fd.set('descriptor', JSON.stringify(payload.descriptor))
    if (payload.templates) fd.set('templates', JSON.stringify(payload.templates))
    const res = await enrollFace(fd)
    if (res.ok) {
      const left = res.data.attemptsLeft
      toast.success(
        left > 0
          ? `Face enrolled. You can now check in. ${left} registration attempt${left === 1 ? '' : 's'} left.`
          : 'Face enrolled. You can now check in. This was your last registration attempt.',
      )
      // The server action revalidated; refresh so the new state is reflected.
      router.refresh()
      return { ok: true }
    }
    return { ok: false, error: res.error }
  }

  async function handleCheckIn(payload: CheckInPayload) {
    const fd = new FormData()
    fd.set('descriptor', JSON.stringify(payload.descriptor))
    fd.set('latitude', String(payload.coords.latitude))
    fd.set('longitude', String(payload.coords.longitude))
    fd.set('accuracy', String(payload.coords.accuracy))
    fd.set('liveness', payload.liveness)
    fd.set('workMode', payload.workMode)
    if (payload.selfie) fd.set('selfie', payload.selfie, 'selfie.jpg')

    const res = await checkIn(fd)
    if (res.ok) {
      if (res.data.pointsAwarded > 0) {
        setReward(res.data.pointsAwarded)
        toast.success(`On time! +${res.data.pointsAwarded} points earned.`)
      } else {
        toast.success('Checked in. Have a good shift.')
      }
      router.refresh()
      return { ok: true }
    }
    return { ok: false, error: res.error }
  }

  async function handleRequestRecheckin() {
    setRequestingRecheckin(true)
    const res = await requestRecheckin(new FormData())
    if (res.ok) {
      toast.success('Re-check-in requested. HR will be notified.')
      router.refresh()
    } else {
      toast.error(res.error)
    }
    setRequestingRecheckin(false)
  }

  async function handleCheckOut(payload: CheckInPayload) {
    const fd = new FormData()
    fd.set('descriptor', JSON.stringify(payload.descriptor))
    fd.set('liveness', payload.liveness)
    fd.set('latitude', String(payload.coords.latitude))
    fd.set('longitude', String(payload.coords.longitude))

    const res = await checkOut(fd)
    if (res.ok) {
      toast.success(`Checked out — ${formatDuration(res.data.work_minutes)} logged.`)
      router.refresh()
      return { ok: true }
    }
    return { ok: false, error: res.error }
  }

  function exportAttendance() {
    const csv = toCsv(
      ['Date', 'Status', 'Check in', 'Check out', 'Hours', 'Late'],
      attendance.map((a) => [
        a.date,
        a.status,
        formatTime(a.check_in),
        formatTime(a.check_out),
        (a.work_minutes / 60).toFixed(2),
        a.is_late ? 'Yes' : 'No',
      ]),
    )
    downloadCsv(`my-attendance-${localDateKey()}.csv`, csv)
    toast.success('Attendance exported.')
  }

  return (
    <DashboardShell
      nav={nav}
      active={active}
      onSelect={setActive}
      userProfile={userProfile}
      notifications={notifications}
      unseenCount={live.notifications.length > 0 ? live.unseenCount : undefined}
      onNotificationsOpen={live.markAllSeen}
    >
      {/* ══ Overview ══════════════════════════════════════════════════════ */}
      {active === 'overview' && (
        <>
          <PageHeader
            title={`Welcome back, ${userProfile.name.split(' ')[0]}`}
            subtitle={<LiveClock />}
          />

          {!employee && (
            <div className="mb-4">
              <Alert tone="warning">
                No employee record is linked to your account yet. Ask HR to finish your
                onboarding before you can check in.
              </Alert>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Check-in card */}
            <Panel className="lg:col-span-1" bodyClassName="p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="muted text-sm">Today</span>
                {todayRecord ? (
                  <StatusBadge status={todayRecord.status} />
                ) : (
                  <span className="muted text-xs">No record</span>
                )}
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="muted mb-0.5 text-xs">Check in</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {formatTime(todayRecord?.check_in ?? null)}
                  </div>
                </div>
                <div>
                  <div className="muted mb-0.5 text-xs">Check out</div>
                  <div className="text-lg font-semibold tabular-nums">
                    {formatTime(todayRecord?.check_out ?? null)}
                  </div>
                </div>
              </div>

              {todayRecord?.is_late && (
                <div className="mb-3">
                  <Alert tone="warning">
                    You checked in after the shift grace period.
                  </Alert>
                </div>
              )}

              {!enrolled ? (
                <>
                  <div className="mb-3">
                    {enrollLocked ? (
                      <Alert tone="warning">
                        You have used all {MAX_FACE_ENROLL_ATTEMPTS} face registration
                        attempts. Ask HR to grant you another before you can register
                        again.
                      </Alert>
                    ) : (
                      <Alert tone="info">
                        Enroll your face once — it becomes the template every future
                        check-in is matched against. You have{' '}
                        <strong>
                          {attemptsLeft} of {MAX_FACE_ENROLL_ATTEMPTS}
                        </strong>{' '}
                        attempts left.
                      </Alert>
                    )}
                  </div>
                  <button
                    onClick={() => setEnrollOpen(true)}
                    disabled={!employee || enrollLocked}
                    className="btn btn-primary w-full"
                  >
                    <ScanFace size={17} />
                    {enrollLocked ? 'Registration locked' : 'Enroll my face'}
                  </button>
                </>
              ) : checkedOut ? (
                <>
                  <div className="rounded-lg bg-[var(--success-soft)] px-3 py-3 text-center">
                    <BadgeCheck
                      size={22}
                      className="mx-auto mb-1"
                      style={{ color: 'var(--success)' }}
                    />
                    <p className="text-sm font-medium">Shift complete</p>
                    <p className="muted mt-0.5 text-xs">
                      {formatDuration(todayRecord!.work_minutes)} logged today
                      {(todayRecord!.session_count ?? 1) > 1 &&
                        ` · ${todayRecord!.session_count} sessions`}
                    </p>
                  </div>
                  {/* Re-check-in needs HR approval. Request → wait → resume. */}
                  {todayRecord?.recheckin_status === 'approved' ? (
                    <button
                      onClick={() => setCheckInOpen(true)}
                      className="btn btn-primary mt-2 w-full"
                    >
                      <LogIn size={16} /> Check in again (approved)
                    </button>
                  ) : todayRecord?.recheckin_status === 'requested' ? (
                    <div className="mt-2">
                      <Alert tone="info">Re-check-in requested — waiting for HR approval.</Alert>
                    </div>
                  ) : (
                    <button
                      onClick={handleRequestRecheckin}
                      disabled={requestingRecheckin}
                      className="btn btn-ghost mt-2 w-full"
                    >
                      {requestingRecheckin ? <Spinner size={16} /> : <LogIn size={16} />}
                      Request re-check-in
                    </button>
                  )}
                </>
              ) : checkedIn ? (
                <button
                  onClick={() => setCheckOutOpen(true)}
                  className="btn btn-danger w-full"
                >
                  <LogOut size={17} /> Check out
                </button>
              ) : (
                <button
                  onClick={() => setCheckInOpen(true)}
                  disabled={!employee}
                  className="btn btn-primary w-full"
                >
                  <LogIn size={17} /> Check in now
                </button>
              )}

              {/* Assignment context */}
              <dl className="mt-4 space-y-2 border-t border-[var(--border)] pt-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <dt className="muted flex items-center gap-1.5">
                    <MapPin size={13} /> Site
                  </dt>
                  <dd className="text-right font-medium">
                    {site?.name ?? 'Unassigned'}
                    {site && (
                      <span
                        className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          background: `color-mix(in srgb, ${siteKindMeta[siteKindOf(site)].color} 16%, transparent)`,
                          color: siteKindMeta[siteKindOf(site)].color,
                        }}
                      >
                        {siteKindMeta[siteKindOf(site)].short}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <dt className="muted flex items-center gap-1.5">
                    <Clock size={13} /> Shift
                  </dt>
                  <dd className="text-right font-medium">
                    {shift
                      ? `${formatShiftTime(shift.start_time)} – ${formatShiftTime(shift.end_time)}`
                      : 'Unassigned'}
                    {shift && (
                      <span
                        className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          background: `color-mix(in srgb, ${workModeMeta[workModeOf(shift)].color} 16%, transparent)`,
                          color: workModeMeta[workModeOf(shift)].color,
                        }}
                      >
                        {workModeMeta[workModeOf(shift)].label}
                      </span>
                    )}
                  </dd>
                </div>
                {shift && (
                  <div className="flex items-start justify-between gap-2">
                    <dt className="muted">Working days</dt>
                    <dd className="text-right font-medium">
                      {shift.work_days.map((d) => WEEKDAY_LABELS[d - 1]).join(', ')}
                    </dd>
                  </div>
                )}
              </dl>
            </Panel>

            {/* Stats + announcements */}
            <div className="space-y-4 lg:col-span-2">
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              >
                <StatCard
                  label="Present"
                  value={monthStats.present}
                  icon={<BadgeCheck size={17} />}
                  tone="var(--success)"
                  sub="this month"
                />
                <StatCard
                  label="Hours logged"
                  value={monthStats.hours}
                  decimals={1}
                  suffix="h"
                  icon={<Timer size={17} />}
                  tone="var(--primary)"
                  sub="this month"
                />
                <StatCard
                  label="Attendance"
                  value={monthStats.rate}
                  decimals={0}
                  suffix="%"
                  icon={<TrendingUp size={17} />}
                  tone="var(--accent)"
                  sub="this month"
                />
                <StatCard
                  label="Leaves taken"
                  value={monthStats.onLeave}
                  icon={<CalendarCheck size={17} />}
                  tone="var(--info)"
                  sub="this month"
                />
              </motion.div>

              <Panel
                title="Latest announcements"
                action={
                  announcements.length > 0 && (
                    <button
                      onClick={() => setActive('announcements')}
                      className="text-xs font-medium text-[var(--primary)] hover:underline cursor-pointer"
                    >
                      View all
                    </button>
                  )
                }
                bodyClassName="p-0"
              >
                {announcements.length === 0 ? (
                  <EmptyState
                    icon={<Megaphone size={30} />}
                    title="Nothing posted yet"
                    description="Company announcements from HR will appear here."
                  />
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {announcements.slice(0, 4).map((a) => (
                      <li key={a.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{a.title}</span>
                          <PriorityBadge priority={a.priority} />
                          <span className="muted ml-auto text-xs">
                            {relativeTime(a.created_at)}
                          </span>
                        </div>
                        <p className="muted mt-1 line-clamp-2 text-sm">{a.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}

      {/* ══ Attendance ════════════════════════════════════════════════════ */}
      {active === 'attendance' && (
        <>
          <PageHeader
            title="My attendance"
            subtitle="Your check-in history and monthly summary"
            action={
              attendance.length > 0 && (
                <button onClick={exportAttendance} className="btn btn-ghost btn-sm">
                  <Download size={15} /> Export CSV
                </button>
              )
            }
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
            <Panel title="Calendar">
              <AttendanceCalendar records={attendance} />
            </Panel>

            <Panel title="History" bodyClassName="p-0">
              {attendance.length === 0 ? (
                <EmptyState
                  icon={<CalendarRange size={30} />}
                  title="No attendance yet"
                  description="Your check-ins will be listed here once you start recording them."
                />
              ) : (
                <div className="table-wrap max-h-[560px] overflow-y-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Status</th>
                        <th>In</th>
                        <th>Out</th>
                        <th>Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendance.map((a) => (
                        <tr key={a.id}>
                          <td className="whitespace-nowrap font-medium">
                            {formatDate(a.date)}
                          </td>
                          <td>
                            <StatusBadge status={a.status} />
                          </td>
                          <td className="tabular-nums">
                            {formatTime(a.check_in)}
                            {a.is_late && (
                              <span
                                className="ml-1.5 text-[10px] font-bold"
                                style={{ color: 'var(--warning)' }}
                              >
                                LATE
                              </span>
                            )}
                          </td>
                          <td className="tabular-nums">{formatTime(a.check_out)}</td>
                          <td className="tabular-nums">{formatDuration(a.work_minutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      {/* ══ Leaves ════════════════════════════════════════════════════════ */}
      {active === 'leaves' && (
        <LeavesSection leaves={leaves} disabled={!employee} />
      )}

      {/* ══ Announcements ═════════════════════════════════════════════════ */}
      {active === 'announcements' && (
        <>
          <PageHeader title="Announcements" subtitle="Company-wide updates from HR" />
          {announcements.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Megaphone size={30} />}
                title="Nothing posted yet"
                description="When HR broadcasts an update, it will show up here."
              />
            </Panel>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="grid gap-3 md:grid-cols-2"
            >
              {announcements.map((a) => (
                <Panel key={a.id}>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{a.title}</h3>
                    <PriorityBadge priority={a.priority} />
                  </div>
                  <p className="muted text-sm">{a.description}</p>
                  <p className="muted mt-3 text-xs">{formatDateTime(a.created_at)}</p>
                </Panel>
              ))}
            </motion.div>
          )}
        </>
      )}

      {/* ══ Profile ═══════════════════════════════════════════════════════ */}
      {active === 'profile' && (
        <ProfileSection
          employee={employee}
          email={email}
          site={site}
          shift={shift}
          enrolled={enrolled}
          attemptsLeft={attemptsLeft}
          firstLogin={firstLogin}
          onReEnroll={() => setEnrollOpen(true)}
        />
      )}

      {/* ══ Modals ════════════════════════════════════════════════════════ */}
      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title={enrolled ? 'Re-enroll your face' : 'Enroll your face'}
        description="Look straight at the camera in even lighting."
      >
        <FaceCheckIn
          mode="enroll"
          workModes={workModes}
          onSubmit={handleEnroll}
          onCancel={() => setEnrollOpen(false)}
        />
      </Modal>

      <Modal
        open={checkInOpen}
        onClose={() => setCheckInOpen(false)}
        title="Check in"
        description="Location and face are both verified before your attendance is recorded."
      >
        <FaceCheckIn
          mode="verify"
          site={site}
          shift={shift}
          workModes={workModes}
          enrolledDescriptor={employee?.face_descriptor ?? null}
          onSubmit={handleCheckIn}
          onCancel={() => setCheckInOpen(false)}
        />
      </Modal>

      <Modal
        open={reward !== null}
        onClose={() => setReward(null)}
        title="Nice work"
        size="sm"
      >
        <div className="space-y-3 text-center">
          <div className="text-4xl">🎉</div>
          <p className="text-lg font-semibold">
            You earned +{reward ?? PUNCTUAL_POINTS} points
          </p>
          <p className="muted text-sm">
            Checked in on time and on site. Points build toward a reward at{' '}
            {REWARD_GOAL.toLocaleString()}.
          </p>
          <div className="rounded-lg bg-[var(--surface-2)] p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="muted">Balance</span>
              <span className="font-semibold tabular-nums">
                {(employee?.reward_points ?? 0) + (reward ?? 0)} / {REWARD_GOAL.toLocaleString()}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (((employee?.reward_points ?? 0) + (reward ?? 0)) / REWARD_GOAL) * 100)}%`,
                  background: 'var(--success)',
                }}
              />
            </div>
          </div>
          <button onClick={() => setReward(null)} className="btn btn-primary w-full">
            Continue
          </button>
        </div>
      </Modal>

      <Modal
        open={checkOutOpen}
        onClose={() => setCheckOutOpen(false)}
        title="Check out"
        description="Verify your face to clock off."
      >
        <FaceCheckIn
          mode="checkout"
          site={site}
          shift={shift}
          enrolledDescriptor={employee?.face_descriptor ?? null}
          onSubmit={handleCheckOut}
          onCancel={() => setCheckOutOpen(false)}
        />
      </Modal>
    </DashboardShell>
  )
}

/* ── Leaves ───────────────────────────────────────────────────────────────── */

function LeavesSection({ leaves, disabled }: { leaves: Leave[]; disabled: boolean }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()
  const today = localDateKey()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const form = e.currentTarget
    const res = await applyLeave(new FormData(form))

    if (res.ok) {
      toast.success('Leave request submitted.')
      form.reset()
      router.refresh()
    } else {
      setError(res.error)
      setSubmitting(false)
    }
  }

  async function handleCancel(id: string) {
    const fd = new FormData()
    fd.set('id', id)
    const res = await cancelLeave(fd)
    if (res.ok) {
      toast.success('Request withdrawn.')
      router.refresh()
    } else {
      toast.error(res.error)
    }
  }

  return (
    <>
      <PageHeader title="My leaves" subtitle="Request time off and track approvals" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        <Panel title="Request leave">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label" htmlFor="leaveType">
                Leave type
              </label>
              <select id="leaveType" name="leaveType" required className="field">
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="startDate">
                  From
                </label>
                <input
                  id="startDate"
                  name="startDate"
                  type="date"
                  required
                  min={today}
                  className="field"
                />
              </div>
              <div>
                <label className="label" htmlFor="endDate">
                  To
                </label>
                <input
                  id="endDate"
                  name="endDate"
                  type="date"
                  required
                  min={today}
                  className="field"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="reason">
                Reason <span className="font-normal">(optional)</span>
              </label>
              <textarea
                id="reason"
                name="reason"
                rows={3}
                placeholder="A short note for your manager"
                className="field resize-y"
              />
            </div>

            {error && <Alert tone="error">{error}</Alert>}

            <button
              type="submit"
              disabled={submitting || disabled}
              className="btn btn-primary w-full"
            >
              {submitting ? <Spinner size={16} /> : <CalendarCheck size={16} />}
              Submit request
            </button>
          </form>
        </Panel>

        <Panel title="My requests" bodyClassName="p-0">
          {leaves.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck size={30} />}
              title="No leave requests"
              description="Requests you submit will be tracked here with their approval status."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Dates</th>
                    <th>Days</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((l) => (
                    <tr key={l.id}>
                      <td className="font-medium">{l.leave_type}</td>
                      <td className="whitespace-nowrap">
                        {formatDate(l.start_date)} → {formatDate(l.end_date)}
                        {l.reason && (
                          <div className="muted mt-0.5 line-clamp-1 text-xs">{l.reason}</div>
                        )}
                      </td>
                      <td className="tabular-nums">{daysBetween(l.start_date, l.end_date)}</td>
                      <td>
                        <LeaveBadge status={l.status} />
                        {l.decision_note && (
                          <div className="muted mt-0.5 text-xs">{l.decision_note}</div>
                        )}
                      </td>
                      <td className="text-right">
                        {l.status === 'pending' && (
                          <button
                            onClick={() => handleCancel(l.id)}
                            className="btn btn-ghost btn-sm"
                          >
                            Withdraw
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}

/* ── Profile ──────────────────────────────────────────────────────────────── */

function ProfileSection({
  employee,
  email,
  site,
  shift,
  enrolled,
  attemptsLeft,
  firstLogin,
  onReEnroll,
}: {
  employee: Employee | null
  email: string
  site: Site | null
  shift: Shift | null
  enrolled: boolean
  attemptsLeft: number
  firstLogin: boolean
  onReEnroll: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await updateMyProfile(new FormData(e.currentTarget))
    if (res.ok) {
      toast.success('Profile updated.')
      router.refresh()
    } else {
      setError(res.error)
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="My profile" subtitle="Your details and work assignment" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Personal details">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label" htmlFor="fullName">
                Full name
              </label>
              <input
                id="fullName"
                name="fullName"
                required
                defaultValue={employee?.full_name ?? ''}
                className="field"
              />
            </div>

            <div>
              <label className="label" htmlFor="profileEmail">
                Email
              </label>
              <input
                id="profileEmail"
                value={email}
                readOnly
                disabled
                className="field"
                aria-describedby="email-help"
              />
              <p id="email-help" className="muted mt-1 text-xs">
                Your sign-in address cannot be changed here — ask HR.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="phone">
                  Phone
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  defaultValue={employee?.phone ?? ''}
                  className="field"
                />
              </div>
              <div>
                <label className="label" htmlFor="gender">
                  Gender
                </label>
                <select
                  id="gender"
                  name="gender"
                  defaultValue={employee?.gender ?? ''}
                  className="field"
                >
                  <option value="">Prefer not to say</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="address">
                Address
              </label>
              <textarea
                id="address"
                name="address"
                rows={2}
                defaultValue={employee?.address ?? ''}
                className="field resize-y"
              />
            </div>

            {error && <Alert tone="error">{error}</Alert>}

            <button type="submit" disabled={saving || !employee} className="btn btn-primary">
              {saving ? <Spinner size={16} /> : null} Save changes
            </button>
          </form>
        </Panel>

        <div className="space-y-4">
          <Panel title="Employment">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Detail label="Employee ID" value={employee?.employee_id} mono />
              <Detail label="Department" value={employee?.department} />
              <Detail label="Designation" value={employee?.designation} />
              <Detail label="Joined" value={employee?.joining_date && formatDate(employee.joining_date)} />
              <Detail label="Work site" value={site?.name} />
              <Detail
                label="Shift"
                value={
                  shift
                    ? `${formatShiftTime(shift.start_time)} – ${formatShiftTime(shift.end_time)}`
                    : null
                }
              />
            </dl>
          </Panel>

          <Panel title="Balance" subtitle="Points earned for punctual, on-site check-ins">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">
                {(employee?.reward_points ?? 0).toLocaleString()}
              </span>
              <span className="muted text-sm">
                / {REWARD_GOAL.toLocaleString()} points
              </span>
            </div>

            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.min(100, ((employee?.reward_points ?? 0) / REWARD_GOAL) * 100)}%`,
                  background: 'var(--success)',
                }}
              />
            </div>

            <p className="muted mt-3 text-sm">
              Earn <strong>{PUNCTUAL_POINTS} points</strong> every time you check in on
              time and on site. <strong>If you earn {REWARD_GOAL.toLocaleString()} points
              you may get a reward.</strong>
            </p>

            {(employee?.reward_points ?? 0) >= REWARD_GOAL && (
              <div className="mt-3">
                <Alert tone="success">
                  You have reached {REWARD_GOAL.toLocaleString()} points — speak to HR
                  about claiming your reward.
                </Alert>
              </div>
            )}
          </Panel>

          <ChangePassword firstLogin={firstLogin} />

          <Panel title="Face enrollment">
            <div className="flex items-start gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
                style={{
                  background: enrolled ? 'var(--success-soft)' : 'var(--warning-soft)',
                  color: enrolled ? 'var(--success)' : 'var(--warning)',
                }}
              >
                <ScanFace size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {enrolled ? 'Face template active' : 'Not enrolled yet'}
                </p>
                <p className="muted mt-0.5 text-xs">
                  {attemptsLeft === 0
                    ? `All ${MAX_FACE_ENROLL_ATTEMPTS} registration attempts used. Ask HR to grant another.`
                    : enrolled
                      ? `Enrolled ${employee?.face_enrolled_at ? formatDate(employee.face_enrolled_at) : ''}. ${attemptsLeft} of ${MAX_FACE_ENROLL_ATTEMPTS} attempts left — re-enroll if your appearance changes significantly.`
                      : `Enroll your face to unlock selfie check-in. ${attemptsLeft} of ${MAX_FACE_ENROLL_ATTEMPTS} attempts left.`}
                </p>
                <button
                  onClick={onReEnroll}
                  disabled={attemptsLeft === 0}
                  className="btn btn-ghost btn-sm mt-3"
                >
                  <ScanFace size={15} />
                  {attemptsLeft === 0 ? 'Locked' : enrolled ? 'Re-enroll' : 'Enroll now'}
                </button>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  )
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string
  value?: string | null
  mono?: boolean
}) {
  return (
    <div>
      <dt className="muted mb-0.5 text-xs">{label}</dt>
      <dd className={`font-medium ${mono ? 'font-mono text-sm' : ''}`}>{value || '—'}</dd>
    </div>
  )
}
