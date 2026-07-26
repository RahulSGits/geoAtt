import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import HrPage from '../hr/page'

export const dynamic = 'force-dynamic'

/**
 * The admin portal.
 *
 * Admins get the same rich console as HR plus the admin-only tiers (Members &
 * access, Sign-in activity, Diagnostics), which HrDashboardClient reveals when
 * `isAdmin` is true. Rather than duplicate the console's data loading, this
 * route reuses the HR page component — the loader there already admits admins
 * and computes `isAdmin` from the session.
 */
export default async function AdminPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect(session.role === 'hr' ? '/hr' : '/employee')

  return HrPage()
}
