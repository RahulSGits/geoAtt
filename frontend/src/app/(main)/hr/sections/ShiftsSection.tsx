'use client'

import { useState } from 'react'
import { Building2, Clock, Home, Laptop, Pencil, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/Modal'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { Alert, EmptyState, PageHeader, Panel, Pill, SearchInput, Spinner } from '@/components/ui'
import { formatDuration, formatShiftTime, WEEKDAY_LABELS } from '@/lib/format'
import { workModeMeta, workModeOf } from '@/lib/types'
import type { Shift, WorkMode } from '@/lib/types'
import { deleteShift, saveShift } from '../actions'

export default function ShiftsSection({ shifts }: { shifts: Shift[] }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Shift | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Shift | null>(null)
  const [deleting, setDeleting] = useState(false)

  const needle = query.trim().toLowerCase()
  const shown = needle
    ? shifts.filter((s) =>
        `${s.name} ${s.start_time ?? ''} ${s.end_time ?? ''}`.toLowerCase().includes(needle),
      )
    : shifts
  const toast = useToast()
  const router = useRouter()

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)

    const fd = new FormData()
    fd.set('id', confirmDelete.id)
    const res = await deleteShift(fd)

    if (res.ok) {
      toast.success('Shift deleted.')
      setConfirmDelete(null)
      router.refresh()
    } else {
      toast.error(res.error)
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Shifts"
        subtitle="Working windows, work mode, and the thresholds that decide each day's status"
        action={
          <button onClick={() => setCreating(true)} className="btn btn-primary btn-sm">
            <Plus size={15} /> Add shift
          </button>
        }
      />

      {shifts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search shifts by name or time"
            label="Search shifts"
          />
          {query && (
            <span className="muted text-xs">
              {shown.length} of {shifts.length}
            </span>
          )}
        </div>
      )}

      {shifts.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Clock size={30} />}
            title="No shifts defined"
            description="Define a shift so lateness and daily status can be calculated."
            action={
              <button onClick={() => setCreating(true)} className="btn btn-primary btn-sm">
                <Plus size={15} /> Add shift
              </button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((shift) => (
            <article
              key={shift.id}
              className="card lift relative overflow-hidden p-4"
              style={{
                borderColor: `color-mix(in srgb, ${workModeMeta[workModeOf(shift)].color} 35%, var(--border))`,
              }}
            >
              {/* Colour bar keyed to work mode, so the three states are
                  separable at a glance across a grid of cards. */}
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1"
                style={{ background: workModeMeta[workModeOf(shift)].color }}
              />
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-medium">{shift.name}</h3>
                  <p className="muted mt-0.5 text-sm tabular-nums">
                    {formatShiftTime(shift.start_time)} – {formatShiftTime(shift.end_time)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setEditing(shift)}
                    aria-label={`Edit ${shift.name}`}
                    className="icon-btn"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(shift)}
                    aria-label={`Delete ${shift.name}`}
                    className="icon-btn icon-btn-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div className="mb-3">
                <WorkModeChip mode={workModeOf(shift)} />
              </div>

              <div className="mb-3 flex flex-wrap gap-1">
                {WEEKDAY_LABELS.map((label, i) => {
                  const on = shift.work_days.includes(i + 1)
                  return (
                    <span
                      key={label}
                      title={label}
                      className="grid h-6 w-6 place-items-center rounded text-[10px] font-semibold"
                      style={{
                        background: on
                          ? `color-mix(in srgb, ${workModeMeta[workModeOf(shift)].color} 18%, transparent)`
                          : 'var(--surface-2)',
                        color: on ? workModeMeta[workModeOf(shift)].color : 'var(--text-subtle)',
                      }}
                    >
                      {label[0]}
                    </span>
                  )
                })}
              </div>

              <dl className="space-y-1.5 border-t border-[var(--border)] pt-2.5 text-xs">
                <Row label="Full day at" value={formatDuration(shift.full_day_minutes)} />
                <Row label="Half day at" value={formatDuration(shift.half_day_minutes)} />
                <Row label="Late after" value={`${shift.grace_minutes} min grace`} />
              </dl>

              <div className="mt-3">
                <Pill tone={shift.is_active ? 'var(--success)' : 'var(--text-muted)'}>
                  {shift.is_active ? 'Active' : 'Inactive'}
                </Pill>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        title={editing ? `Edit ${editing.name}` : 'Add shift'}
        size="lg"
      >
        <ShiftForm
          key={editing?.id ?? 'new'}
          shift={editing}
          onDone={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete shift?"
        description={confirmDelete?.name}
        size="sm"
      >
        <div className="space-y-3">
          <Alert tone="warning">
            Employees on this shift will lose their schedule, and their daily status will
            fall back to the default 8-hour rule.
          </Alert>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="btn btn-ghost">
              Cancel
            </button>
            <button onClick={handleDelete} disabled={deleting} className="btn btn-danger">
              {deleting && <Spinner size={16} />} Delete
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

const MODE_ICON: Record<WorkMode, typeof Home> = {
  on_site: Building2,
  remote: Home,
  hybrid: Laptop,
}

function WorkModeChip({ mode }: { mode: WorkMode }) {
  const meta = workModeMeta[mode]
  const Icon = MODE_ICON[mode]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
        color: meta.color,
      }}
    >
      <Icon size={13} />
      {meta.label}
    </span>
  )
}

function WorkModePicker({
  value,
  onChange,
}: {
  value: WorkMode
  onChange: (mode: WorkMode) => void
}) {
  return (
    <fieldset>
      <legend className="label">Work mode</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(workModeMeta) as WorkMode[]).map((mode) => {
          const meta = workModeMeta[mode]
          const Icon = MODE_ICON[mode]
          const active = value === mode
          return (
            <label
              key={mode}
              className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors"
              style={{
                borderColor: active ? meta.color : 'var(--border)',
                background: active
                  ? `color-mix(in srgb, ${meta.color} 10%, transparent)`
                  : 'transparent',
              }}
            >
              <input
                type="radio"
                name="workModeRadio"
                value={mode}
                checked={active}
                onChange={() => onChange(mode)}
                className="sr-only"
              />
              <Icon
                size={16}
                className="mt-0.5 shrink-0"
                style={{ color: active ? meta.color : 'var(--text-muted)' }}
              />
              <span className="min-w-0">
                <span
                  className="block text-sm font-medium"
                  style={{ color: active ? meta.color : 'var(--text)' }}
                >
                  {meta.label}
                </span>
                <span className="muted block text-xs">{meta.description}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function ShiftForm({ shift, onDone }: { shift: Shift | null; onDone: () => void }) {
  const [workMode, setWorkMode] = useState<WorkMode>(workModeOf(shift))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const fd = new FormData(e.currentTarget)
    if (shift) fd.set('id', shift.id)
    fd.set('workMode', workMode)

    const res = await saveShift(fd)
    if (res.ok) {
      toast.success(shift ? 'Shift updated.' : 'Shift created.')
      onDone()
      router.refresh()
    } else {
      setError(res.error)
      setSubmitting(false)
    }
  }

  // `time` inputs want HH:MM; Postgres hands back HH:MM:SS.
  const timeValue = (t?: string) => (t ? t.slice(0, 5) : '')

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="shift-name">
          Shift name *
        </label>
        <input
          id="shift-name"
          name="name"
          required
          defaultValue={shift?.name}
          placeholder="General Shift"
          className="field"
        />
      </div>

      <WorkModePicker value={workMode} onChange={setWorkMode} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="shift-start">
            Starts
          </label>
          <input
            id="shift-start"
            name="startTime"
            type="time"
            required
            defaultValue={timeValue(shift?.start_time) || '09:00'}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="shift-end">
            Ends
          </label>
          <input
            id="shift-end"
            name="endTime"
            type="time"
            required
            defaultValue={timeValue(shift?.end_time) || '18:00'}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="shift-grace">
            Grace (min)
          </label>
          <input
            id="shift-grace"
            name="graceMinutes"
            type="number"
            min={0}
            max={180}
            defaultValue={shift?.grace_minutes ?? 15}
            className="field"
          />
        </div>
      </div>

      <fieldset>
        <legend className="label">Working days</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_LABELS.map((label, i) => (
            <label
              key={label}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-2 text-sm has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-soft)]"
            >
              <input
                type="checkbox"
                name="workDays"
                value={i + 1}
                defaultChecked={(shift?.work_days ?? [1, 2, 3, 4, 5]).includes(i + 1)}
                className="h-3.5 w-3.5 accent-[var(--primary)]"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="shift-full">
            Full day after (minutes)
          </label>
          <input
            id="shift-full"
            name="fullDayMinutes"
            type="number"
            min={1}
            max={1440}
            required
            defaultValue={shift?.full_day_minutes ?? 480}
            className="field"
            aria-describedby="full-help"
          />
          <p id="full-help" className="muted mt-1 text-xs">
            Worked at least this long → Present.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="shift-half">
            Half day after (minutes)
          </label>
          <input
            id="shift-half"
            name="halfDayMinutes"
            type="number"
            min={1}
            max={1440}
            required
            defaultValue={shift?.half_day_minutes ?? 240}
            className="field"
            aria-describedby="half-help"
          />
          <p id="half-help" className="muted mt-1 text-xs">
            Below this → Absent. Between the two → Half day.
          </p>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          value="true"
          defaultChecked={shift?.is_active ?? true}
          className="h-4 w-4 accent-[var(--primary)]"
        />
        Active
      </label>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="btn btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting && <Spinner size={16} />} {shift ? 'Save changes' : 'Create shift'}
        </button>
      </div>
    </form>
  )
}
