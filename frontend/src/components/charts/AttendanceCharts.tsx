'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { statusMeta } from '@/lib/format'
import type { AttendanceStatus } from '@/lib/types'

const AXIS_STYLE = { fontSize: 11, fill: 'var(--text-muted)' }

/** Tooltip styled with the app's tokens so it reads correctly in both themes. */
const tooltipStyle = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    fontSize: 12,
    color: 'var(--text)',
    boxShadow: 'var(--shadow-md)',
  },
  labelStyle: { color: 'var(--text-muted)', marginBottom: 4 },
  itemStyle: { color: 'var(--text)' },
} as const

export function AttendanceTrend({
  data,
}: {
  data: { date: string; present: number; absent: number; late: number }[]
}) {
  if (data.length === 0) return <ChartEmpty />

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-present" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grad-absent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="present"
          name="Present"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#grad-present)"
        />
        <Area
          type="monotone"
          dataKey="absent"
          name="Absent"
          stroke="var(--chart-3)"
          strokeWidth={2}
          fill="url(#grad-absent)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function DepartmentBars({
  data,
}: {
  data: { department: string; headcount: number }[]
}) {
  if (data.length === 0) return <ChartEmpty />

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
        <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="department"
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={100}
        />
        <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar dataKey="headcount" name="Employees" radius={[0, 6, 6, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={`var(--chart-${(i % 6) + 1})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StatusDonut({
  data,
}: {
  data: { status: AttendanceStatus; count: number }[]
}) {
  const total = data.reduce((sum, d) => sum + d.count, 0)
  if (total === 0) return <ChartEmpty />

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="status"
            innerRadius={58}
            outerRadius={86}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.status} fill={statusMeta[d.status].color} />
            ))}
          </Pie>
          <Tooltip
            {...tooltipStyle}
            formatter={(value, name) => [
              String(value ?? 0),
              statusMeta[name as AttendanceStatus]?.label ?? String(name),
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums">{total}</span>
        <span className="muted text-xs">records</span>
      </div>

      <ul className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1.5">
        {data.map((d) => (
          <li key={d.status} className="muted flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: statusMeta[d.status].color }}
            />
            {statusMeta[d.status].label}
            <span className="tabular-nums opacity-70">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChartEmpty() {
  return (
    <div className="muted grid h-[200px] place-items-center text-sm">
      Not enough data to chart yet
    </div>
  )
}
