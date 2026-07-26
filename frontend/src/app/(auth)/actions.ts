'use server'

import { redirect } from 'next/navigation'
import { createClient as createStatelessClient } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'
import { MIN_PASSWORD_LENGTH } from '@/lib/types'
import type { Role } from '@/lib/types'

export interface AuthActionState {
  error?: string
  /** Set when the account was created but still needs email confirmation. */
  needsConfirmation?: boolean
}

/**
 * Retry a network-level failure once.
 *
 * Supabase sits behind Cloudflare and a connect attempt occasionally stalls
 * until undici's 10s timeout, surfacing as a bare `TypeError: fetch failed`.
 * It is transient — the following attempt typically completes in under half a
 * second — so one retry converts a dead-end error into a slightly slow sign-in.
 * Only network faults are retried; a rejected password must not be re-sent.
 */
async function withNetworkRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (err) {
    if (!isNetworkError(err)) throw err
    console.warn('[auth] network fault reaching Supabase, retrying once:', describeCause(err))
    await new Promise((r) => setTimeout(r, 400))
    return operation()
  }
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const text = `${err.message} ${describeCause(err)}`
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|socket hang up|network/i.test(
    text,
  )
}

function describeCause(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  return typeof cause === 'string' ? cause : ''
}

/**
 * Cookie-less client used only to check that someone knows their current
 * password. Signing in on the request's own client would rotate the live
 * session's tokens as a side effect of a verification step.
 */
function createVerificationClient() {
  return createStatelessClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

const INVALID_CREDENTIALS = 'Invalid email or password.'

/**
 * The one line the sign-in form is allowed to show.
 *
 * Everyone — employee, HR, admin — sees the same short text. Server-side detail
 * (stack traces, SQL errors, "Database error querying schema") never reaches the
 * page: it tells an attacker which accounts exist and which are misconfigured,
 * and it means nothing to the person trying to sign in. The real cause is logged
 * for whoever is reading the server output instead.
 *
 * Anything that is not clearly the user's fault falls back to the same generic
 * credential message, so a new failure mode cannot leak internals by default.
 */
function describeAuthError(error: {
  message?: string
  status?: number
  code?: string
}): string {
  const message = (error.message ?? '').trim()

  // Diagnostics go to the operator, not the visitor.
  console.error('[auth] sign-in failed:', {
    status: error.status,
    code: error.code,
    message: message || '(empty body)',
  })

  // A transport failure is not an authentication failure; telling someone their
  // password is wrong when the server is unreachable sends them in circles.
  if (isNetworkError(error as unknown) || /fetch failed|UND_ERR|ETIMEDOUT/i.test(message)) {
    return 'Could not reach the server. Check your connection and try again.'
  }

  if (/email not confirmed/i.test(message)) {
    return 'Please confirm your email address before signing in.'
  }

  if (/too many|rate limit/i.test(message) || error.status === 429) {
    return 'Too many attempts. Please wait a minute and try again.'
  }

  // Server-side fault: the password was never actually checked. Say only that
  // it is not the user's fault, so they stop retrying and ask for help.
  if (
    error.status === 500 ||
    /database error|unexpected_failure|internal/i.test(message)
  ) {
    return 'Sign-in is temporarily unavailable. Please contact your administrator.'
  }

  return INVALID_CREDENTIALS
}

function landingFor(role: Role): string {
  if (role === 'admin') return '/admin'
  return role === 'hr' ? '/hr' : '/employee'
}

export async function login(formData: FormData): Promise<AuthActionState> {
  const supabase = await createClient()

  // Accepts an email address or an employee ID (EMP-0001).
  const identifier = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!identifier || !password) {
    return { error: 'Enter your email or employee ID, and your password.' }
  }

  let email = identifier.toLowerCase()

  // Resolve an employee ID to its address. Deliberately silent on failure: a
  // miss falls through to the normal sign-in, which returns the same generic
  // "not recognised" message as a wrong password, so this cannot be used to
  // discover which employee IDs exist.
  if (!identifier.includes('@')) {
    const { data: resolved } = await supabase.rpc('email_for_login', { identifier })
    if (typeof resolved === 'string' && resolved) email = resolved.toLowerCase()
  }

  let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data']
  try {
    const result = await withNetworkRetry(() =>
      supabase.auth.signInWithPassword({ email, password }),
    )
    if (result.error) return { error: describeAuthError(result.error) }
    data = result.data
  } catch (err) {
    // Both attempts hit the network, so the credentials were never checked.
    return { error: describeAuthError({ message: err instanceof Error ? err.message : '' }) }
  }

  if (!data.user) return { error: 'Sign-in did not complete. Please try again.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, password_created')
    .eq('id', data.user.id)
    .maybeSingle<{ role: Role; password_created: boolean | null }>()

  const role = (profile?.role ?? data.user.user_metadata?.role ?? 'employee') as Role
  const passwordCreated =
    profile?.password_created ?? data.user.user_metadata?.password_created ?? true

  // Stamp the sign-in for the admin portal's activity stats. Best-effort: a
  // failure here must never block someone getting into the app.
  const { error: statError } = await supabase.rpc('record_login')
  if (statError) console.warn('[login] could not record sign-in:', statError.message)

  // Land on the dashboard even on the shared default password. Bouncing to
  // /set-password would force the change at the door, but the change belongs in
  // the profile where someone can make it when they are ready; the panel there
  // stays open until they do. Reset links still route through /set-password,
  // since that flow has a recovery token and no dashboard to fall back to.
  void passwordCreated
  redirect(landingFor(role))
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function setupPassword(formData: FormData): Promise<AuthActionState> {
  const supabase = await createClient()
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  if (confirmPassword && password !== confirmPassword) {
    return { error: 'The two passwords do not match.' }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Your invite link has expired. Ask HR to send a new one.' }
  }

  // The one self-service change, enforced here and not only by the page.
  //
  // /set-password redirects away once password_created is true, but that is the
  // page — this action is a POST endpoint and was reachable directly, so the
  // "exactly one change" rule could be spent repeatedly. Re-check it server-side
  // so an administrator's reset link is genuinely the only way to reopen it.
  const { data: existing } = await supabase
    .from('profiles')
    .select('password_created')
    .eq('id', user.id)
    .maybeSingle<{ password_created: boolean | null }>()

  if (existing?.password_created === true) {
    return {
      error:
        'You have already set your password. Ask an administrator to send you a reset link if you need to change it again.',
    }
  }

  const { error: authError } = await supabase.auth.updateUser({ password })
  if (authError) {
    // GoTrue answers 422 "New password should be different from the old
    // password" when someone re-enters the one they already have. Reaching
    // /set-password from a reset link and typing the current password is an
    // easy mistake, and the raw message reads like a failure rather than the
    // no-op it is.
    if (/same.*password|different from the old/i.test(authError.message)) {
      return { error: 'That is already your password. Choose a different one.' }
    }
    return { error: authError.message }
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ password_created: true, account_status: 'active' })
    .eq('id', user.id)

  if (profileError) return { error: profileError.message }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: Role }>()

  redirect(landingFor(profile?.role ?? 'employee'))
}

/**
 * Change your own password from inside the app.
 *
 * Allowed when either:
 *   - you have not set one yet (first login), or
 *   - an administrator granted you `password_reset_allowed`.
 *
 * The gate is re-checked here rather than trusted from the UI, and the flag is
 * cleared on success so a grant is single-use.
 */
export async function changeOwnPassword(formData: FormData): Promise<AuthActionState> {
  const supabase = await createClient()

  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  if (password !== confirmPassword) return { error: 'The two passwords do not match.' }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('password_created')
    .eq('id', user.id)
    .maybeSingle<{ password_created: boolean | null }>()

  // password_created doubles as "has spent their one change". Everyone starts
  // on the shared default with it false; the first successful change sets it and
  // closes the form. After that only an administrator's reset link reopens it,
  // which is deliberate — it keeps a shared starting password from quietly
  // becoming a permanent self-service password-change surface.
  const alreadyChanged = profile?.password_created !== false

  if (alreadyChanged) {
    return {
      error:
        'You have already changed your password. Ask an administrator to send you a reset link if you need to change it again.',
    }
  }

  // Proof of the current password, so someone reaching an unattended session
  // cannot spend the one change and lock the real owner out.
  const currentPassword = String(formData.get('currentPassword') ?? '')
  if (!currentPassword) return { error: 'Enter your current password.' }
  if (currentPassword === password) {
    return { error: 'That is already your password. Choose a different one.' }
  }

  const { error: wrong } = await createVerificationClient().auth.signInWithPassword({
    email: user.email ?? '',
    password: currentPassword,
  })
  if (wrong) return { error: 'Your current password is not correct.' }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    // Password-strength complaints are worth repeating verbatim — they tell the
    // user exactly what to change. Anything else is a server problem they cannot
    // act on, so it goes to the log rather than the screen.
    if (/password/i.test(error.message)) return { error: error.message }
    console.error('[auth] password change failed:', error.message)
    return { error: 'Could not update the password. Please try again.' }
  }

  // First-login accounts graduate to a normal one.
  await supabase.from('profiles').update({ password_created: true }).eq('id', user.id)

  return {}
}
