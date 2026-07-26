'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { localDateKey } from '@/lib/format'
import type { AttendanceWithEmployee } from '@/lib/types'

const WEEK_HEADS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export interface DayTotals {
  present: number
  half: number
  absent: number
  leave: number
  pending: number
  remote: number
  /** Everyone with a record that day, whatever the status. */
  total: number
}

/**
 * Month grid of company-wide attendance: one cell per day, showing how many
 * people were in.
 *
 * Deliberately not the employee's AttendanceCalendar. That one assumes a single
 * record per date and colours the cell by its status; here a date holds the
 * whole roster, so the cell carries a headcount and the colour reads as
 * coverage rather than as one person's day.
 */
export default function TeamAttendanceCalendar({
  records,
  headcount,
  selected,
  onSelect,
  initialMonth,
}: {
  records: AttendanceWithEmployee[]
  /** Active staff, used as the denominator. */
  headcount: number
  selected: string | null
  onSelect: (date: string | null) => void
  initialMonth?: Date
}) {
  const [cursor, setCursor] = useState(() => {
    const d = initialMonth ?? new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const byDate = useMemo(() => {
    const map = new Map<string, DayTotals>()
    for (const r of records) {
      const t =
        map.get(r.date) ??
        { present: 0, half: 0, absent: 0, leave: 0, pending: 0, remote: 0, total: 0 }
      if (r.status in t) t[r.status as keyof DayTotals]++
      if (r.work_mode === 'remote') t.remote++
      t.total++
      map.set(r.date, t)
    }
    return map
  }, [records])

  const { cells, monthLabel } = useMemo(() => {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const first = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // Monday-first grid: JS Sunday is 0, so shift it to the end.
    const leading = (first.getDay() + 6) % 7

    const out: ({ day: number; key: string } | null)[] = Array(leading).fill(null)
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      out.push({ day, key })
    }
    while (out.length % 7 !== 0) out.push(null)

    return {
      cells: out,
      monthLabel: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    }
  }, [cursor])

  // Local day, not the UTC one: cells are keyed by local date, so toISOString()
  // would ring the wrong square either side of midnight.
  const todayKey = localDateKey()
  const shift = (delta: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))

  /** Green deepens with coverage, so a thin day is visible at a glance. */
  const tint = (inCount: number): number => {
    if (!headcount || inCount === 0) return 0
    return Math.min(1, inCount / headcount)
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => shift(-1)}
          aria-label="Previous month"
          className="touch-target muted rounded-lg transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-semibold">{monthLabel}</span>
        <button
          onClick={() => shift(1)}
          aria-label="Next month"
          className="touch-target muted rounded-lg transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEK_HEADS.map((d, i) => (
          <div key={i} className="muted pb-1 text-center text-[11px] font-medium">
            {d}
          </div>
        ))}

        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} />

          const t = byDate.get(cell.key)
          const inCount = t ? t.present + t.half : 0
          const isToday = cell.key === todayKey
          const isFuture = cell.key > todayKey
          const isSelected = cell.key === selected
          const strength = tint(inCount)

          const title = t
            ? `${cell.key} — ${inCount} of ${headcount} in` +
              (t.remote ? `, ${t.remote} WFH` : '') +
              (t.leave ? `, ${t.leave} on leave` : '') +
              (t.absent ? `, ${t.absent} absent` : '')
            : `${cell.key} — no records`

          return (
            <button
              key={cell.key}
              type="button"
              // Clicking the selected day again clears it, so the table goes
              // back to the range filter without hunting for a reset control.
              onClick={() => onSelect(isSelected ? null : cell.key)}
              disabled={!t}
              title={title}
              aria-label={title}
              aria-pressed={isSelected}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                isToday ? 'ring-2 ring-[var(--primary)]' : ''
              } ${isSelected ? 'ring-2 ring-offset-1 ring-[var(--accent)]' : ''} ${
                isFuture ? 'opacity-35' : ''
              } ${t ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
              style={{
                background: strength
                  ? `color-mix(in srgb, var(--success) ${Math.round(14 + strength * 46)}%, transparent)`
                  : 'var(--surface-2)',
                color: strength > 0.55 ? 'var(--success-strong, var(--success))' : 'var(--text-subtle)',
              }}
            >
              {/* The count sits ABOVE the date, small, so a month scans as
                  coverage first and dates second. */}
              {t && (
                <span className="text-[9px] font-bold leading-none tabular-nums opacity-80">
                  {inCount}/{headcount}
                </span>
              )}
              <span className="tabular-nums leading-tight">{cell.day}</span>
              {t && t.remote > 0 && (
                <span
                  className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--info)' }}
                  aria-hidden
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="muted mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: 'color-mix(in srgb, var(--success) 55%, transparent)' }}
          />
          In (present + half day)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--info)' }} />
          Someone worked from home
        </span>
        <span>Click a day to see it in full.</span>
      </div>
    </div>
  )
}
