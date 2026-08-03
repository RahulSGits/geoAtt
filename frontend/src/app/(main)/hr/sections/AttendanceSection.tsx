'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, CalendarRange, Download, Pencil, Search, X } from 'lucide-react'
import Modal from '@/components/Modal'
import TeamAttendanceCalendar from '@/components/TeamAttendanceCalendar'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import {
  Alert,
  Avatar,
  EmptyState,
  PageHeader,
  Panel,
  SegmentedControl,
  Spinner,
} from '@/components/ui'
import {
  downloadCsv,
  formatDate,
  formatDuration,
  formatTime,
  localDateKey,
  toCsv,
} from '@/lib/format'
import type { AttendanceWithEmployee, EmployeeWithAssignment } from '@/lib/types'
import { overrideAttendance } from '../actions'
import AttendanceStatusEditor from './AttendanceStatusEditor'

type Range = 'today' | '7d' | '30d' | 'all'

const RANGE_DAYS: Record<Range, number | null> = {
  today: 0,
  '7d': 7,
  '30d': 30,
  all: null,
}

export default function AttendanceSection({
  attendance,
  employees,
}: {
  attendance: AttendanceWithEmployee[]
  employees: EmployeeWithAssignment[]
}) {
  const [range, setRange] = useState<Range>('today')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [marking, setMarking] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  /** A day picked on the calendar. Overrides the range control while set. */
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const toast = useToast()

  const activeHeadcount = useMemo(
    () => employees.filter((e) => e.status === 'active').length,
    [employees],
  )

  const filtered = useMemo(() => {
    const days = RANGE_DAYS[range]
    let cutoff: string | null = null
    if (days !== null) {
      const d = new Date()
      d.setDate(d.getDate() - days)
      cutoff = localDateKey(d)
    }

    const q = query.trim().toLowerCase()
    return attendance.filter((a) => {
      // A day chosen on the calendar is the whole filter — the range control
      // would otherwise hide the very day just clicked (e.g. "Today" + a date
      // last week returns nothing, which reads as a broken calendar).
      if (selectedDay) {
        if (a.date !== selectedDay) return false
      } else if (cutoff && a.date < cutoff) {
        return false
      }
      // "wfh" is not a status — it is the work mode, and it sits alongside a
      // status (a WFH day is still Present / Half day). Matching on work_mode
      // keeps this filter identical to the WFH badge shown in the table.
      if (statusFilter === 'wfh') {
        if (a.work_mode !== 'remote') return false
      } else if (statusFilter !== 'all' && a.status !== statusFilter) {
        return false
      }
      if (!q) return true
      const name = a.employees?.full_name?.toLowerCase() ?? ''
      const empId = a.employees?.employee_id?.toLowerCase() ?? ''
      return name.includes(q) || empId.includes(q)
    })
  }, [attendance, range, query, statusFilter, selectedDay])

  const summary = useMemo(() => {
    const counts = { present: 0, half: 0, absent: 0, leave: 0, pending: 0 }
    for (const a of filtered) {
      if (a.status in counts) counts[a.status as keyof typeof counts] += 1
    }
    return counts
  }, [filtered])

  function exportCsv() {
    const csv = toCsv(
      ['Date', 'Employee ID', 'Name', 'Department', 'Status', 'Check in', 'Check out', 'Hours', 'Late'],
      filtered.map((a) => [
        a.date,
        a.employees?.employee_id ?? '',
        a.employees?.full_name ?? '',
        a.employees?.department ?? '',
        a.status,
        formatTime(a.check_in),
        formatTime(a.check_out),
        (a.work_minutes / 60).toFixed(2),
        a.is_late ? 'Yes' : 'No',
      ]),
    )
    // Name the file after the day when one is picked, so a folder of daily
    // exports is readable without opening them.
    downloadCsv(
      selectedDay
        ? `attendance-${selectedDay}.csv`
        : `attendance-${range}-${localDateKey()}.csv`,
      csv,
    )
    toast.success(
      selectedDay
        ? `Exported ${filtered.length} records for ${formatDate(selectedDay)}.`
        : `Exported ${filtered.length} records.`,
    )
  }

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Every recorded check-in across the company"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setShowCalendar((v) => !v)}
              aria-pressed={showCalendar}
              className="btn btn-ghost btn-sm"
            >
              <CalendarDays size={15} /> {showCalendar ? 'Hide calendar' : 'Calendar'}
            </button>
            <button
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="btn btn-ghost btn-sm"
            >
              <Download size={15} /> Export
            </button>
            <button onClick={() => setMarking(true)} className="btn btn-primary btn-sm">
              <Pencil size={15} /> Mark manually
            </button>
          </div>
        }
      />

      {showCalendar && (
        <div className="mb-4">
          <Panel>
            <TeamAttendanceCalendar
              records={attendance}
              headcount={activeHeadcount}
              selected={selectedDay}
              onSelect={setSelectedDay}
            />
          </Panel>
        </div>
      )}

      {selectedDay && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
          <span className="text-sm">
            Showing <strong>{formatDate(selectedDay)}</strong> —{' '}
            <span className="muted">
              {filtered.length} record{filtered.length === 1 ? '' : 's'}
            </span>
          </span>
          <div className="flex gap-2">
            <button
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="btn btn-ghost btn-sm"
            >
              <Download size={15} /> Download this day
            </button>
            <button onClick={() => setSelectedDay(null)} className="btn btn-ghost btn-sm">
              <X size={15} /> Clear
            </button>
          </div>
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryTile label="Present" value={summary.present} color="var(--success)" />
        <SummaryTile label="Half day" value={summary.half} color="var(--warning)" />
        <SummaryTile label="Absent" value={summary.absent} color="var(--danger)" />
        <SummaryTile label="On leave" value={summary.leave} color="var(--info)" />
        <SummaryTile label="In progress" value={summary.pending} color="var(--chart-4)" />
      </div>

      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] p-3">
          <SegmentedControl
            label="Date range"
            value={range}
            onChange={setRange}
            options={[
              { value: 'today', label: 'Today' },
              { value: '7d', label: '7 days' },
              { value: '30d', label: '30 days' },
              { value: 'all', label: 'All' },
            ]}
          />

          <div className="relative min-w-[180px] flex-1">
            <Search
              size={15}
              className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employee"
              aria-label="Search attendance by employee"
              className="field pl-9"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="field w-auto min-w-[140px]"
          >
            <option value="all">All statuses</option>
            <option value="present">Present</option>
            <option value="wfh">Work from home</option>
            <option value="half">Half day</option>
            <option value="absent">Absent</option>
            <option value="leave">On leave</option>
            <option value="pending">In progress</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<CalendarRange size={30} />}
            title="No records in this range"
            description="Widen the date range or clear the filters to see more."
          />
        ) : (
          <div className="table-wrap max-h-[600px] overflow-y-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Hours</th>
                  <th>Re-check-in</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={a.employees?.full_name ?? '?'} size={28} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {a.employees?.full_name ?? 'Unknown'}
                          </div>
                          <div className="muted truncate text-xs">
                            {a.employees?.department ?? '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{formatDate(a.date)}</td>
                    <td>
                      <AttendanceStatusEditor record={a} />
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
                    <td>
                      {/*
                        Surfaced in the row, not only inside the editor. A
                        request that is only visible after opening a record is
                        one nobody discovers — and the employee is blocked until
                        it is answered.
                      */}
                      {a.recheckin_status === 'requested' ? (
                        <span
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
                            color: 'var(--warning)',
                          }}
                        >
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: 'var(--warning)' }}
                          />
                          Re-check-in
                        </span>
                      ) : a.recheckin_status === 'approved' ? (
                        <span className="muted text-[11px]">Approved</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={marking}
        onClose={() => setMarking(false)}
        title="Mark attendance manually"
        description="Use this to correct a day the automatic rules got wrong."
      >
        <ManualForm employees={employees} onDone={() => setMarking(false)} />
      </Modal>
    </>
  )
}

function SummaryTile({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        <span className="muted text-xs">{label}</span>
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

function ManualForm({
  employees,
  onDone,
}: {
  employees: EmployeeWithAssignment[]
  onDone: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const res = await overrideAttendance(new FormData(e.currentTarget))
    if (res.ok) {
      toast.success('Attendance updated.')
      onDone()
      router.refresh()
    } else {
      setError(res.error)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="ma-employee">
          Employee
        </label>
        <select id="ma-employee" name="employeeId" required className="field">
          <option value="">Select an employee</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name} ({e.employee_id})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="ma-date">
            Date
          </label>
          <input
            id="ma-date"
            name="date"
            type="date"
            required
            defaultValue={localDateKey()}
            max={localDateKey()}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="ma-status">
            Status
          </label>
          <select id="ma-status" name="status" required defaultValue="present" className="field">
            <option value="present">Present</option>
            <option value="half">Half day</option>
            <option value="absent">Absent</option>
            <option value="leave">On leave</option>
            <option value="off">Week off</option>
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="ma-note">
          Note <span className="font-normal">(optional)</span>
        </label>
        <input
          id="ma-note"
          name="note"
          placeholder="Why this was changed"
          className="field"
        />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="btn btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting && <Spinner size={16} />} Save
        </button>
      </div>
    </form>
  )
}
