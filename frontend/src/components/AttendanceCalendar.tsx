'use client'

import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDuration, localDateKey, statusMeta } from '@/lib/format'
import type { Attendance, AttendanceStatus } from '@/lib/types'

const WEEK_HEADS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Month grid of attendance, one cell per day, colour + letter coded. */
export default function AttendanceCalendar({
  records,
  initialMonth,
}: {
  records: Attendance[]
  initialMonth?: Date
}) {
  const [cursor, setCursor] = useState(() => {
    const d = initialMonth ?? new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const byDate = useMemo(() => {
    const map = new Map<string, Attendance>()
    for (const r of records) map.set(r.date, r)
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

  // Must be the local day, not the UTC one: cells are keyed by local date, so
  // `toISOString()` would ring the wrong square either side of midnight.
  const todayKey = localDateKey()
  const shift = (delta: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))

  const legend: AttendanceStatus[] = ['present', 'half', 'absent', 'leave', 'pending']

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

          const record = byDate.get(cell.key)
          const meta = record ? statusMeta[record.status] : null
          const isToday = cell.key === todayKey
          const isFuture = cell.key > todayKey

          const title = record
            ? `${cell.key}: ${meta!.label}${record.work_minutes ? ` · ${formatDuration(record.work_minutes)}` : ''}`
            : `${cell.key}: no record`

          return (
            <motion.div
              key={cell.key}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.006, 0.25) }}
              title={title}
              className={`relative grid aspect-square place-items-center rounded-lg text-xs font-medium ${
                isToday ? 'ring-2 ring-[var(--primary)]' : ''
              } ${isFuture ? 'opacity-35' : ''}`}
              style={{
                background: meta
                  ? `color-mix(in srgb, ${meta.color} 16%, transparent)`
                  : 'var(--surface-2)',
                color: meta ? meta.color : 'var(--text-subtle)',
              }}
            >
              <span className="tabular-nums">{cell.day}</span>
              {/* Letter code so the status survives greyscale and colour blindness. */}
              {meta && (
                <span className="absolute bottom-0.5 text-[8px] font-bold opacity-70">
                  {meta.short}
                </span>
              )}
            </motion.div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
        {legend.map((status) => (
          <span key={status} className="muted flex items-center gap-1.5 text-[11px]">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: statusMeta[status].color }}
            />
            {statusMeta[status].label}
          </span>
        ))}
      </div>
    </div>
  )
}
