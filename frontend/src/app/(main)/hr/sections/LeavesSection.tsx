'use client'

import { useMemo, useState } from 'react'
import { CalendarCheck, Check, X } from 'lucide-react'
import Modal from '@/components/Modal'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import {
  Alert,
  Avatar,
  EmptyState,
  LeaveBadge,
  PageHeader,
  Panel,
  SegmentedControl,
  Spinner,
} from '@/components/ui'
import { daysBetween, formatDate, relativeTime } from '@/lib/format'
import type { LeaveStatus, LeaveWithEmployee } from '@/lib/types'
import { decideLeave } from '../actions'

type Filter = 'pending' | 'approved' | 'rejected' | 'all'

export default function LeavesSection({ leaves }: { leaves: LeaveWithEmployee[] }) {
  const [filter, setFilter] = useState<Filter>('pending')
  const [deciding, setDeciding] = useState<{
    leave: LeaveWithEmployee
    decision: Exclude<LeaveStatus, 'pending'>
  } | null>(null)

  const filtered = useMemo(
    () => (filter === 'all' ? leaves : leaves.filter((l) => l.status === filter)),
    [leaves, filter],
  )

  const pendingCount = leaves.filter((l) => l.status === 'pending').length

  return (
    <>
      <PageHeader
        title="Leave requests"
        subtitle={
          pendingCount > 0
            ? `${pendingCount} awaiting your decision`
            : 'Nothing awaiting a decision'
        }
        action={
          <SegmentedControl
            label="Leave status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'all', label: 'All' },
            ]}
          />
        }
      />

      <Panel bodyClassName="p-0">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck size={30} />}
            title={filter === 'pending' ? 'No pending requests' : 'Nothing here'}
            description={
              filter === 'pending'
                ? 'New leave requests will appear here for approval.'
                : 'Try a different filter.'
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={l.employees?.full_name ?? '?'} size={30} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {l.employees?.full_name ?? 'Unknown'}
                          </div>
                          <div className="muted truncate text-xs">
                            {l.employees?.department ?? '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{l.leave_type}</td>
                    <td className="whitespace-nowrap">
                      {formatDate(l.start_date)} → {formatDate(l.end_date)}
                      {l.reason && (
                        <div className="muted mt-0.5 line-clamp-1 max-w-[220px] text-xs">
                          {l.reason}
                        </div>
                      )}
                    </td>
                    <td className="tabular-nums">{daysBetween(l.start_date, l.end_date)}</td>
                    <td>
                      <LeaveBadge status={l.status} />
                      <div className="muted mt-0.5 text-xs">
                        {l.status === 'pending'
                          ? `filed ${relativeTime(l.created_at)}`
                          : l.decided_at
                            ? relativeTime(l.decided_at)
                            : ''}
                      </div>
                    </td>
                    <td>
                      {l.status === 'pending' && (
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => setDeciding({ leave: l, decision: 'approved' })}
                            className="btn btn-success btn-sm"
                          >
                            <Check size={14} /> Approve
                          </button>
                          <button
                            onClick={() => setDeciding({ leave: l, decision: 'rejected' })}
                            className="btn btn-danger btn-sm"
                          >
                            <X size={14} /> Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding?.decision === 'approved' ? 'Approve leave' : 'Reject leave'}
        description={
          deciding
            ? `${deciding.leave.employees?.full_name}: ${deciding.leave.leave_type}, ${formatDate(deciding.leave.start_date)} to ${formatDate(deciding.leave.end_date)}`
            : undefined
        }
        size="sm"
      >
        {deciding && (
          <DecisionForm
            leave={deciding.leave}
            decision={deciding.decision}
            onDone={() => setDeciding(null)}
          />
        )}
      </Modal>
    </>
  )
}

function DecisionForm({
  leave,
  decision,
  onDone,
}: {
  leave: LeaveWithEmployee
  decision: Exclude<LeaveStatus, 'pending'>
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

    const fd = new FormData(e.currentTarget)
    fd.set('id', leave.id)
    fd.set('decision', decision)

    const res = await decideLeave(fd)
    if (res.ok) {
      toast.success(
        decision === 'approved'
          ? 'Leave approved and marked on the attendance sheet.'
          : 'Leave rejected.',
      )
      onDone()
      router.refresh()
    } else {
      setError(res.error)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {decision === 'approved' && (
        <Alert tone="info">
          Each day in this range will be marked as leave on the attendance sheet.
        </Alert>
      )}

      <div>
        <label className="label" htmlFor="decision-note">
          Note to employee <span className="font-normal">(optional)</span>
        </label>
        <textarea
          id="decision-note"
          name="note"
          rows={3}
          placeholder={
            decision === 'approved' ? 'Enjoy your time off' : 'Reason for the rejection'
          }
          className="field resize-y"
        />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn btn-ghost">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={`btn ${decision === 'approved' ? 'btn-success' : 'btn-danger'}`}
        >
          {submitting && <Spinner size={16} />}
          {decision === 'approved' ? 'Approve' : 'Reject'}
        </button>
      </div>
    </form>
  )
}
