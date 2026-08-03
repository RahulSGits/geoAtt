import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'

import type { Role } from './roles'
import { isSupabaseConfigured, requireSupabase, supabase } from './supabase'

/**
 * Auth state and actions, on Supabase — the same project and accounts as the
 * web app.
 *
 * There is deliberately NO register function. geoAtt has no public sign-up on
 * any platform: accounts are provisioned by an administrator or HR, and this
 * app only signs into one that already exists. Removing the capability here —
 * rather than hiding the button — means a future screen cannot quietly wire it
 * back up.
 */
type AuthState = {
  user: User | null
  /**
   * The caller's role, from public.profiles.
   *
   * Read once here rather than at each call site: RLS already restricts the
   * row to the caller, so this is one round trip that every screen would
   * otherwise repeat. Null while loading, and for a session whose profile row
   * has been deleted — which the proxy on web treats as signed out.
   */
  role: Role | null
  fullName: string | null
  /** False until the persisted session has been replayed — gates the first route. */
  ready: boolean
  signIn: (identifier: string, password: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  logOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/**
 * Resolve what the user typed into the email to sign in with.
 *
 * Employees can sign in with their employee code (EMP-0001) as well as email,
 * matching the web app. The lookup goes through the `email_for_login` RPC,
 * which is SECURITY DEFINER and returns only an email. Every failure — no '@',
 * RPC not yet applied, no such code — falls through to the raw input, so the
 * eventual error is always the same generic "incorrect" message and the field
 * cannot be used to enumerate which codes exist.
 */
async function resolveLoginEmail(identifier: string): Promise<string> {
  const trimmed = identifier.trim()
  if (trimmed.includes('@')) return trimmed
  try {
    const { data } = await requireSupabase().rpc('email_for_login', { identifier: trimmed })
    return typeof data === 'string' && data ? data : trimmed
  } catch {
    return trimmed
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [fullName, setFullName] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      // Nothing to wait for; let the UI render its "not configured" state.
      setReady(true)
      return
    }

    // Replay the persisted session first, then track changes. The listener
    // also fires on TOKEN_REFRESHED and SIGNED_OUT, so `user` stays honest for
    // the app's whole lifetime, not just at sign-in.
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setReady(true)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setReady(true)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user || !supabase) {
      setRole(null)
      setFullName(null)
      return
    }
    let cancelled = false
    supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setRole((data?.role as Role) ?? null)
        setFullName((data?.full_name as string) ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const value = useMemo<AuthState>(
    () => ({
      user,
      role,
      fullName,
      ready,
      signIn: async (identifier, password) => {
        const email = await resolveLoginEmail(identifier)
        const { error } = await requireSupabase().auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      resetPassword: async (email) => {
        const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim())
        if (error) throw error
      },
      logOut: async () => {
        if (supabase) await supabase.auth.signOut()
      },
    }),
    [user, role, fullName, ready],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/**
 * Supabase auth errors are English strings rather than stable codes — match
 * loosely and fall back to a generic line instead of leaking internals.
 *
 * Sign-in failures deliberately do not distinguish "no such account" from
 * "wrong password" — that difference is an account-enumeration oracle, and
 * Supabase's own "Invalid login credentials" already collapses the two.
 */
export function authErrorMessage(error: unknown): string {
  const message =
    typeof error === 'object' && error && 'message' in error ? String(error.message) : ''

  if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect.'
  if (/email not confirmed/i.test(message))
    return 'This account has not been activated yet. Contact HR.'
  if (/rate limit|too many|security purposes/i.test(message))
    return 'Too many attempts. Try again in a few minutes.'
  if (/network|fetch|failed to connect/i.test(message))
    return 'No connection. Check your network and try again.'
  // The requireSupabase() setup message is aimed at whoever runs the project —
  // pass it through instead of blurring it into "something went wrong".
  if (/not configured/i.test(message)) return message
  return 'Something went wrong. Please try again.'
}
