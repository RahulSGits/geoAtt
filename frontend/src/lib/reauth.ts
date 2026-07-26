/**
 * Step-up authentication: proof that the person driving this session is the
 * account owner, not someone who found it unattended.
 *
 * Used to gate the destructive actions — deleting an employee, deleting a
 * member account. A role check answers "may this account do it"; this answers
 * "is this really that account", which is the question that matters when the
 * cost of being wrong is an unrecoverable delete.
 *
 * Import only from server code.
 */

import { createClient as createStatelessClient } from '@supabase/supabase-js'
import { AuthError } from './auth'

/**
 * Verification runs on a cookie-less client on purpose.
 *
 * `signInWithPassword` on the request's own client would mint a new token pair
 * and write it to the session cookie — so a check that is supposed to be
 * read-only would silently rotate the live session as a side effect, and a
 * *failed* check could leave the user logged out mid-action.
 */
function verificationClient() {
  return createStatelessClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// ---------------------------------------------------------------------------
// Throttle
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000
/** Wrong attempts older than this stop counting toward the lockout. */
const WINDOW_MS = 15 * 60 * 1000

interface Attempts {
  count: number
  first: number
  lockedUntil: number
}

/**
 * Per-user failure counters.
 *
 * In-process and therefore per-instance: on a multi-instance deployment an
 * attacker gets MAX_ATTEMPTS per instance rather than MAX_ATTEMPTS overall.
 * That is a deliberate floor, not the whole defence — GoTrue rate-limits the
 * same requests upstream, and the actions behind this gate are already
 * role-restricted. Moving the counter to Postgres would make it exact; it is
 * not worth a write on the happy path until there is a reason.
 */
const attempts = new Map<string, Attempts>()

/** Keep the map from growing without bound on a long-lived server. */
function prune(now: number) {
  if (attempts.size < 500) return
  for (const [key, value] of attempts) {
    if (value.lockedUntil < now && now - value.first > WINDOW_MS) attempts.delete(key)
  }
}

function remainingLockout(userId: string, now: number): number {
  const record = attempts.get(userId)
  if (!record) return 0
  return record.lockedUntil > now ? record.lockedUntil - now : 0
}

function recordFailure(userId: string, now: number) {
  const record = attempts.get(userId)

  if (!record || now - record.first > WINDOW_MS) {
    attempts.set(userId, { count: 1, first: now, lockedUntil: 0 })
    return
  }

  record.count += 1
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS
    record.count = 0
    record.first = now
  }
}

function minutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000))
}

/**
 * Throw unless `password` is the current password of `email`.
 *
 * Throws `AuthError`, so the calling server action's existing `toResult`
 * mapping turns it into a clean `{ ok: false, error }` rather than a 500.
 *
 * A correct password clears the failure count; a wrong one counts toward a
 * temporary lockout, so this cannot be used to guess a password at speed.
 */
export async function requirePassword(
  userId: string,
  email: string,
  password: string,
): Promise<void> {
  const now = Date.now()
  prune(now)

  const locked = remainingLockout(userId, now)
  if (locked > 0) {
    throw new AuthError(
      `Too many incorrect passwords. Try again in ${minutes(locked)} minute(s).`,
    )
  }

  if (!password) throw new AuthError('Enter your password to confirm.')
  if (!email) throw new AuthError('Your account has no email address to verify against.')

  const { error } = await verificationClient().auth.signInWithPassword({ email, password })

  if (error) {
    // A 500 here means GoTrue could not read the row (the NULL-token fault the
    // auth repair migration fixes), so the password was never actually checked.
    // Saying "wrong password" would send the user round in circles.
    if (error.status === 500 || /database error|unexpected_failure/i.test(error.message)) {
      console.error('[reauth] verification could not run:', error.message)
      throw new AuthError(
        'Could not verify your password right now. Please contact your administrator.',
      )
    }

    recordFailure(userId, now)
    throw new AuthError('That password is not correct. Nothing was deleted.')
  }

  attempts.delete(userId)
}
