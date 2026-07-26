'use client'

import { motion, useReducedMotion } from 'motion/react'
import { Search as SearchIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AttendanceStatus, LeaveStatus, Priority } from '@/lib/types'
import {
  hueFor,
  initials,
  leaveStatusMeta,
  priorityMeta,
  statusMeta,
} from '@/lib/format'

/* ── Motion presets ──────────────────────────────────────────────────────── */

/** Stagger container matching the skill's "Stagger List" preset (300-450ms). */
export const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}

export const staggerItem = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 26 },
  },
}

/* ── Numbers ─────────────────────────────────────────────────────────────── */

interface NumberProps {
  value: number
  decimals?: number
  suffix?: string
  duration?: number
}

const formatNumber = (n: number, decimals: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

/** Count-up on mount, and again whenever `value` changes. */
export function AnimatedNumber(props: NumberProps) {
  const reduceMotion = useReducedMotion()

  // Branch to a separate component rather than short-circuiting inside the
  // animation effect — with motion off there is no state to hold at all.
  if (reduceMotion) {
    return (
      <span>
        {formatNumber(props.value, props.decimals ?? 0)}
        {props.suffix ?? ''}
      </span>
    )
  }
  return <CountUp {...props} />
}

function CountUp({ value, decimals = 0, suffix = '', duration = 700 }: NumberProps) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)

  useEffect(() => {
    const start = from.current
    const delta = value - start
    if (delta === 0) return

    const t0 = performance.now()
    let frame = 0

    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(start + delta * eased)
      if (p < 1) frame = requestAnimationFrame(step)
      else from.current = value
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  return (
    <span>
      {formatNumber(shown, decimals)}
      {suffix}
    </span>
  )
}

/* ── Cards & panels ──────────────────────────────────────────────────────── */

export function StatCard({
  label,
  value,
  decimals,
  suffix,
  icon,
  tone = 'var(--primary)',
  sub,
  trend,
}: {
  label: string
  value: number
  decimals?: number
  suffix?: string
  icon: React.ReactNode
  tone?: string
  sub?: string
  trend?: { value: number; label: string }
}) {
  return (
    <motion.div
      variants={staggerItem}
      className="card lift group relative overflow-hidden p-4"
    >
      <div
        aria-hidden
        className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-35"
        style={{ background: tone }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="muted text-sm">{label}</span>
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-transform duration-200 group-hover:scale-110"
          style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}
        >
          {icon}
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums">
        <AnimatedNumber value={value} decimals={decimals} suffix={suffix} />
      </div>
      <div className="mt-1 flex items-center gap-2">
        {sub && <span className="muted text-xs">{sub}</span>}
        {trend && (
          <span
            className="text-xs font-medium tabular-nums"
            style={{ color: trend.value >= 0 ? 'var(--success)' : 'var(--danger)' }}
          >
            {trend.value >= 0 ? '▲' : '▼'} {Math.abs(trend.value).toFixed(0)}% {trend.label}
          </span>
        )}
      </div>
    </motion.div>
  )
}

export function Panel({
  title,
  subtitle,
  children,
  action,
  className = '',
  bodyClassName = 'p-4',
  style,
  accent,
}: {
  title?: string
  subtitle?: string
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
  bodyClassName?: string
  style?: React.CSSProperties
  /** Draws a colour bar across the top edge, for at-a-glance categorisation. */
  accent?: string
}) {
  return (
    // `relative` so an accent bar can pin to the top edge.
    <section className={`card relative overflow-hidden ${className}`} style={style}>
      {accent && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: accent }}
        />
      )}
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            {subtitle && <p className="muted mt-0.5 text-xs">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <div className="muted mt-1 text-sm">{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}

/* ── Identity ────────────────────────────────────────────────────────────── */

export function Avatar({
  name,
  size = 36,
  src,
}: {
  name: string
  size?: number
  src?: string | null
}) {
  const hue = hueFor(name)
  if (src) {
    return (
      // Storage-signed URLs are remote and short-lived, so next/image's
      // optimiser would just add a broken indirection here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-2 ring-[var(--border)]"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-white/20"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 62% 48%), hsl(${(hue + 45) % 360} 62% 40%))`,
      }}
    >
      {initials(name)}
    </span>
  )
}

/* ── Status ──────────────────────────────────────────────────────────────── */

export function StatusBadge({ status }: { status: AttendanceStatus }) {
  const meta = statusMeta[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
        color: meta.color,
      }}
    >
      {/* A dot plus the word — colour alone never carries the meaning. */}
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function LeaveBadge({ status }: { status: LeaveStatus }) {
  const meta = leaveStatusMeta[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
        color: meta.color,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = priorityMeta[priority]
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
        color: meta.color,
      }}
    >
      {meta.label}
    </span>
  )
}

export function Pill({
  children,
  tone = 'var(--primary)',
}: {
  children: React.ReactNode
  tone?: string
}) {
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}
    >
      {children}
    </span>
  )
}

/* ── States ──────────────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <span className="muted mb-3 opacity-40">{icon}</span>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="muted mt-1 max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]"
      style={{ width: size, height: size }}
    />
  )
}

/** Inline form error, rendered next to the field it belongs to. */
export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
      {children}
    </p>
  )
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error'
  children: React.ReactNode
}) {
  const color = {
    info: 'var(--info)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    error: 'var(--danger)',
  }[tone]

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="rounded-lg border px-3 py-2.5 text-sm"
      style={{
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
        color,
      }}
    >
      {children}
    </div>
  )
}

/** Segmented control used for date-range and view switches. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`relative rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              active ? 'text-[var(--primary-fg)]' : 'muted hover:text-[var(--text)]'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${label}`}
                className="absolute inset-0 rounded-md"
                style={{ background: 'var(--primary)' }}
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Search box used by every filterable list.
 *
 * Extracted so the sections that gained filtering later match the ones that
 * always had it — same icon inset, same padding, same affordances — rather than
 * each growing a slightly different input.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  className?: string
}) {
  return (
    <div className={`relative min-w-[200px] flex-1 ${className}`}>
      <SearchIcon
        size={15}
        className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="field pl-9"
      />
    </div>
  )
}
