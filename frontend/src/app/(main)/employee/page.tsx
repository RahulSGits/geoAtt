import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getSession } from '@/lib/auth'
import { localDateKey } from '@/lib/format'
import EmployeeDashboardClient from './EmployeeDashboardClient'
import type { Announcement, Attendance, Employee, Leave, Shift, Site } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function EmployeePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'employee') redirect('/hr')

  const supabase = await createClient()

  const { data: employee } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', session.userId)
    .maybeSingle<Employee>()

  // A year of history covers the calendar and every summary on the page.
  const since = new Date()
  since.setFullYear(since.getFullYear() - 1)

  const [attendanceRes, leavesRes, announcementsRes, siteRes, shiftRes] = await Promise.all([
    employee
      ? supabase
          .from('attendance')
          .select('*')
          .eq('employee_id', employee.id)
          .gte('date', localDateKey(since))
          .order('date', { ascending: false })
      : Promise.resolve({ data: [] as Attendance[] }),
    employee
      ? supabase
          .from('leaves')
          .select('*')
          .eq('employee_id', employee.id)
          .order('start_date', { ascending: false })
      : Promise.resolve({ data: [] as Leave[] }),
    supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20),
    employee?.site_id
      ? supabase.from('sites').select('*').eq('id', employee.site_id).maybeSingle<Site>()
      : Promise.resolve({ data: null }),
    employee?.shift_id
      ? supabase.from('shifts').select('*').eq('id', employee.shift_id).maybeSingle<Shift>()
      : Promise.resolve({ data: null }),
  ])

  const attendance = (attendanceRes.data ?? []) as Attendance[]
  const today = localDateKey()

  return (
    <EmployeeDashboardClient
      userProfile={{ id: session.userId, name: session.name, role: 'employee' }}
      email={session.email}
      firstLogin={session.profile?.password_created === false}
      employee={employee ?? null}
      site={siteRes.data ?? null}
      shift={shiftRes.data ?? null}
      attendance={attendance}
      todayRecord={attendance.find((a) => a.date === today) ?? null}
      leaves={(leavesRes.data ?? []) as Leave[]}
      announcements={(announcementsRes.data ?? []) as Announcement[]}
    />
  )
}
