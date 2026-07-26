import { redirect } from 'next/navigation'
import { KeyRound, Mail, Shield, ShieldCheck, User } from 'lucide-react'
import { createClient } from '@/utils/supabase/server'
import SetPasswordForm from './SetPasswordForm'

export const dynamic = 'force-dynamic'

/** How each portal is described to someone who has not seen FinAtt yet. */
const PORTALS = {
  admin: { label: 'Admin', blurb: 'Full access, including members and access', icon: Shield },
  hr: { label: 'HR', blurb: 'People, attendance, leave and sites', icon: ShieldCheck },
  employee: { label: 'Employee', blurb: 'Check in, request leave, view your attendance', icon: User },
} as const

export default async function SetPasswordPage() {
  const supabase = await createClient()

  // Reaching this page requires the session created by the invite link.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, password_created')
    .eq('id', user.id)
    .maybeSingle<{
      full_name: string | null
      role: string
      password_created: boolean | null
    }>()

  // Already set up — send them on rather than letting them reset by accident.
  if (profile?.password_created) {
    redirect(
      profile.role === 'admin' ? '/admin' : profile.role === 'hr' ? '/hr' : '/employee',
    )
  }

  // The role is only ever read here, never chosen — a password form must not be
  // able to change what the account can reach.
  const role = (profile?.role ?? 'employee') as keyof typeof PORTALS
  const portal = PORTALS[role] ?? PORTALS.employee
  const PortalIcon = portal.icon
  const email = user.email ?? '—'

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="card w-full max-w-md p-8">
        <div className="text-center">
          <span
            className="mx-auto grid h-12 w-12 place-items-center rounded-2xl"
            style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
          >
            <KeyRound size={22} />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Set your password</h1>
          <p className="muted mt-2 text-sm">
            {profile?.full_name ? `Welcome, ${profile.full_name}. ` : 'Welcome to FinAtt. '}
            Choose a password to finish setting up your account.
          </p>
        </div>

        {/* Which account this is for. An invite link and a reset link both land
            here, so state the address and portal plainly — someone with two
            accounts, or forwarded the wrong link, should not have to guess. */}
        <dl className="mt-6 space-y-px overflow-hidden rounded-xl border border-[var(--border)] text-sm">
          <div className="flex items-center gap-3 bg-[var(--surface-2)] px-3.5 py-3">
            <Mail size={15} className="shrink-0 text-[var(--text-muted)]" />
            <dt className="muted shrink-0 text-xs">Email</dt>
            <dd className="ml-auto min-w-0 truncate font-medium" title={email}>
              {email}
            </dd>
          </div>
          <div className="flex items-center gap-3 bg-[var(--surface-2)] px-3.5 py-3">
            <PortalIcon size={15} className="shrink-0 text-[var(--text-muted)]" />
            <dt className="muted shrink-0 text-xs">Role</dt>
            <dd className="ml-auto min-w-0 text-right">
              <span className="font-medium">{portal.label}</span>
              <span className="muted block truncate text-xs">{portal.blurb}</span>
            </dd>
          </div>
        </dl>

        <SetPasswordForm />
      </div>
    </div>
  )
}
