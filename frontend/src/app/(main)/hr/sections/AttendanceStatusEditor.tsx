'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Home, Pencil } from 'lucide-react'
import Modal from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { Alert, Spinner, StatusBadge } from '@/components/ui'
import { formatDate, statusMeta } from '@/lib/format'
import type { AttendanceStatus, AttendanceWithEmployee } from '@/lib/types'
import { decideRecheckin, editAttendanceTimes, overrideAttendance } from '../actions'

/** Statuses HR may set by hand. `late` is derived from the shift, not chosen. */
const EDITABLE: AttendanceStatus[] = ['present', 'half', 'absent', 'leave', 'off', 'pending']

/** `2026-07-22T09:03:00.000Z` -> `09:03` in the viewer's local zone, for a time input. */
function toTimeInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * HR-only attendance editor.
 *
 * The pill opens a single dialog for status *and* the check-in/out times, so a
 * correction is one deliberate action rather than an accidental click on a
 * dropdown. Times are payroll-critical, which is exactly why they live behind
 * this dialog and are never exposed to the employee.
 */
export default function AttendanceStatusEditor({
  record,
}: {
  record: AttendanceWithEmployee
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<AttendanceStatus>(record.status)
  const [wfh, setWfh] = useState(record.work_mode === 'remote')
  const [checkIn, setCheckIn] = useState(toTimeInput(record.check_in))
  const [checkOut, setCheckOut] = useState(toTimeInput(record.check_out))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [recheckBusy, setRecheckBusy] = useState(false)
  const toast = useToast()
  const router = useRouter()

  async function decideRecheck(decision: 'approved' | 'denied') {
    setRecheckBusy(true)
    const fd = new FormData()
    fd.set('attendanceId', record.id)
    fd.set('decision', decision)
    const res = await decideRecheckin(fd)
    if (res.ok) {
      toast.success(decision === 'approved' ? 'Re-check-in approved.' : 'Re-check-in denied.')
      setOpen(false)
      router.refresh()
    } else {
      toast.error(res.error)
    }
    setRecheckBusy(false)
  }

  // Reset the form to the record's values each time the dialog opens, so a
  // cancelled edit does not bleed into the next one.
  function openEditor() {
    setStatus(record.status)
    setWfh(record.work_mode === 'remote')
    setCheckIn(toTimeInput(record.check_in))
    setCheckOut(toTimeInput(record.check_out))
    setError(null)
    setOpen(true)
  }

  const timesChanged =
    checkIn !== toTimeInput(record.check_in) || checkOut !== toTimeInput(record.check_out)
  const statusChanged = status !== record.status
  const wfhChanged = wfh !== (record.work_mode === 'remote')

  async function save() {
    if (checkIn && checkOut && checkOut <= checkIn) {
      setError('Check-out must be after check-in.')
      return
    }
    if (!statusChanged && !timesChanged && !wfhChanged) {
      setOpen(false)
      return
    }

    setSaving(true)
    setError(null)

    // Times first: writing check_in/out lets the trigger recompute hours. Doing
    // it before the status means an explicit status override is not clobbered by
    // the recomputation.
    if (timesChanged) {
      const fd = new FormData()
      fd.set('employeeId', record.employee_id)
      fd.set('date', record.date)
      fd.set('checkIn', checkIn)
      fd.set('checkOut', checkOut)
      // The times were typed against this browser's clock. The server renders
      // in UTC, so without the offset every correction was stored shifted.
      fd.set('tzOffsetMinutes', String(new Date().getTimezoneOffset()))
      const res = await editAttendanceTimes(fd)
      if (!res.ok) {
        setError(res.error)
        setSaving(false)
        return
      }
    }

    if (statusChanged || wfhChanged) {
      const fd = new FormData()
      fd.set('employeeId', record.employee_id)
      fd.set('date', record.date)
      fd.set('status', status)
      if (wfh) fd.set('workMode', 'remote')
      const res = await overrideAttendance(fd)
      if (!res.ok) {
        setError(res.error)
        setSaving(false)
        return
      }
    }

    toast.success(`Attendance for ${record.employees?.full_name ?? 'employee'} updated.`)
    setSaving(false)
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <button
        onClick={openEditor}
        aria-label={`Edit attendance for ${record.employees?.full_name ?? 'this record'}`}
        className="group inline-flex items-center gap-1.5 rounded-full transition-opacity hover:opacity-80 cursor-pointer"
      >
        <StatusBadge status={record.status} />
        {record.work_mode === 'remote' && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: 'color-mix(in srgb, var(--info) 16%, transparent)', color: 'var(--info)' }}
          >
            <Home size={9} /> WFH
          </span>
        )}
        <Pencil
          size={11}
          className="muted opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit attendance"
        description={`${record.employees?.full_name ?? 'Employee'} · ${formatDate(record.date)}`}
        size="sm"
      >
        <div className="space-y-4">
          {/* Pending re-check-in request */}
          {record.recheckin_status === 'requested' && (
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--info)', background: 'color-mix(in srgb, var(--info) 8%, transparent)' }}>
              <p className="text-sm font-medium">Re-check-in requested</p>
              <p className="muted mt-0.5 text-xs">
                {record.employees?.full_name ?? 'This employee'} wants to check in again today.
                {record.recheckin_note ? ` "${record.recheckin_note}"` : ''}
              </p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => decideRecheck('approved')} disabled={recheckBusy} className="btn btn-success btn-sm">
                  Approve
                </button>
                <button onClick={() => decideRecheck('denied')} disabled={recheckBusy} className="btn btn-danger btn-sm">
                  Deny
                </button>
              </div>
            </div>
          )}
          {record.recheckin_status === 'approved' && (
            <Alert tone="success">Re-check-in approved — the employee can start another session.</Alert>
          )}

          {/* Status */}
          <div>
            <span className="label">Status</span>
            <div className="flex flex-wrap gap-1.5">
              {EDITABLE.map((option) => {
                const meta = statusMeta[option]
                const active = status === option
                return (
                  <button
                    key={option}
                    onClick={() => setStatus(option)}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                    style={{
                      borderColor: active ? meta.color : 'var(--border)',
                      background: active
                        ? `color-mix(in srgb, ${meta.color} 14%, transparent)`
                        : 'transparent',
                      color: active ? meta.color : 'var(--text-muted)',
                    }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
                    {meta.label}
                  </button>
                )
              })}
            </div>

            {/* Work-from-home flag — records the day as worked remotely. */}
            <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
              style={{
                borderColor: wfh ? 'var(--info)' : 'var(--border)',
                background: wfh ? 'color-mix(in srgb, var(--info) 14%, transparent)' : 'transparent',
                color: wfh ? 'var(--info)' : 'var(--text-muted)',
              }}
            >
              <input
                type="checkbox"
                checked={wfh}
                onChange={(e) => setWfh(e.target.checked)}
                className="sr-only"
              />
              <Home size={13} /> Worked from home (WFH)
            </label>
          </div>

          {/* Times — HR only */}
          <div>
            <span className="label flex items-center gap-1.5">
              <Clock size={12} /> Check-in / check-out times
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="muted mb-1 block text-xs" htmlFor="edit-checkin">
                  Check in
                </label>
                <input
                  id="edit-checkin"
                  type="time"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="field"
                />
              </div>
              <div>
                <label className="muted mb-1 block text-xs" htmlFor="edit-checkout">
                  Check out
                </label>
                <input
                  id="edit-checkout"
                  type="time"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="field"
                />
              </div>
            </div>
            <p className="muted mt-1.5 text-xs">
              Editing times recomputes the logged hours. Leave both blank to clear the day.
            </p>
          </div>

          {statusChanged && (
            <Alert tone="info">
              Setting the status by hand pins it — the automatic rules will not change it
              back on the next check-in.
            </Alert>
          )}

          {error && <Alert tone="error">{error}</Alert>}

          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="btn btn-ghost">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || (!statusChanged && !timesChanged && !wfhChanged)}
              className="btn btn-primary"
            >
              {saving && <Spinner size={16} />} Save changes
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
