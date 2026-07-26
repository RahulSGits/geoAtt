'use client'

import dynamic from 'next/dynamic'

/**
 * Recharts pulls in ~440 KB of d3 modules. Only the Overview tab renders a
 * chart, and every chart sits below the fold, so loading it eagerly delayed
 * interactivity on all seven HR tabs. Splitting it out means the console
 * becomes usable first and the charts stream in behind a skeleton.
 *
 * `ssr: false` because Recharts measures the DOM to size its containers —
 * server-rendering it produces a 0×0 chart that flashes on hydration.
 */
const chartSkeleton = (height: number) =>
  function ChartSkeleton() {
    return <div className="skeleton w-full rounded-lg" style={{ height }} aria-label="Loading chart" />
  }

export const AttendanceTrend = dynamic(
  () => import('./AttendanceCharts').then((m) => m.AttendanceTrend),
  { ssr: false, loading: chartSkeleton(240) },
)

export const DepartmentBars = dynamic(
  () => import('./AttendanceCharts').then((m) => m.DepartmentBars),
  { ssr: false, loading: chartSkeleton(200) },
)

export const StatusDonut = dynamic(
  () => import('./AttendanceCharts').then((m) => m.StatusDonut),
  { ssr: false, loading: chartSkeleton(220) },
)
