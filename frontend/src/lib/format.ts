/** Shared date, duration and export formatting. */

import type { AttendanceStatus, LeaveStatus, Priority } from './types'

/** `YYYY-MM-DD` for the user's local day — never the UTC day. */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  // Bare `YYYY-MM-DD` parses as UTC midnight, which renders as the previous day
  // west of Greenwich. Pin it to local noon so the calendar date is stable.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value)
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return `${formatDate(iso)}, ${formatTime(iso)}`
}

/** 495 -> "8h 15m" */
export function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '0m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Inclusive day count between two `YYYY-MM-DD` dates. */
export function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T12:00:00`)
  const b = new Date(`${end}T12:00:00`)
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1)
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

/** `09:00:00` -> `09:00 AM` */
export function formatShiftTime(time: string): string {
  const [h, m] = time.split(':')
  const date = new Date()
  date.setHours(Number(h), Number(m), 0, 0)
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** ISO weekday, 1 = Monday .. 7 = Sunday (JS `getDay()` puts Sunday at 0). */
export function isoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay()
}

export const statusMeta: Record<
  AttendanceStatus,
  { label: string; color: string; short: string }
> = {
  present: { label: 'Present', color: '#10b981', short: 'P' },
  half: { label: 'Half day', color: '#f59e0b', short: 'H' },
  absent: { label: 'Absent', color: '#ef4444', short: 'A' },
  leave: { label: 'On leave', color: '#3b82f6', short: 'L' },
  off: { label: 'Week off', color: '#94a3b8', short: 'O' },
  pending: { label: 'In progress', color: '#8b5cf6', short: '•' },
  late: { label: 'Late', color: '#f59e0b', short: 'T' },
}

export const leaveStatusMeta: Record<LeaveStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#f59e0b' },
  approved: { label: 'Approved', color: '#10b981' },
  rejected: { label: 'Rejected', color: '#ef4444' },
}

export const priorityMeta: Record<Priority, { label: string; color: string }> = {
  low: { label: 'Low', color: '#94a3b8' },
  normal: { label: 'Normal', color: '#3b82f6' },
  high: { label: 'Important', color: '#ef4444' },
}

/** Serialise rows to CSV, quoting and escaping every field. */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (v: string | number | null) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`
  return [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join(
    '\r\n',
  )
}

/** Trigger a client-side file download of `content`. */
export function downloadCsv(filename: string, content: string) {
  // The BOM makes Excel read the file as UTF-8 instead of the system codepage.
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Stable hue per name, so an avatar keeps its colour across renders. */
export function hueFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
}
