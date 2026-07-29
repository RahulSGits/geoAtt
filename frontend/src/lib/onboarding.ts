import { MIN_PASSWORD_LENGTH } from '@/lib/types'

/**
 * The password new HR and employee accounts start on.
 *
 * SERVER ONLY. Never import this from a `'use client'` module — doing so
 * compiles the value into the JavaScript bundle served to every browser, which
 * is exactly the exposure this file exists to close. Client code that needs to
 * display it calls the HR-guarded `getOnboardingPassword` server action.
 *
 * It lives in the environment rather than in source because this repository is
 * public: the previous constant in lib/types.ts was the starting
 * credential for the whole company sitting in a file anyone could read on
 * GitHub, and it was in the client bundle as well.
 *
 * A shared value is a deliberate trade-off, not an oversight. Bulk-importing a
 * roster of 119 people has to hand out something that can be communicated once,
 * to everyone; per-account random strings are unusable without email. The
 * mitigations are elsewhere and already built: `password_created` gates a
 * single self-service change, and once Resend is configured invites switch to a
 * recovery link and stop using this at all.
 */
export function onboardingPassword(): string | null {
  const value = process.env.ONBOARDING_PASSWORD?.trim()
  if (!value || value.length < MIN_PASSWORD_LENGTH) return null
  return value
}

/** Why the onboarding password is unusable, for Diagnostics. Null when fine. */
export function describeOnboardingPassword(): string | null {
  const raw = process.env.ONBOARDING_PASSWORD?.trim()
  if (!raw) {
    return `Not set. Add ONBOARDING_PASSWORD to frontend/.env.local and restart. Until then, creating logins is refused rather than falling back to a weak shared default.`
  }
  if (raw.length < MIN_PASSWORD_LENGTH) {
    return `Set, but only ${raw.length} characters. It must be at least ${MIN_PASSWORD_LENGTH}.`
  }
  return null
}

/**
 * The message every "no onboarding password" failure shows.
 *
 * Deliberately refuses rather than inventing a fallback: a silent default is
 * how the old value ended up being every account's password for months.
 */
export const ONBOARDING_PASSWORD_HELP =
  'No onboarding password is configured. Set ONBOARDING_PASSWORD in frontend/.env.local (at least ' +
  `${MIN_PASSWORD_LENGTH} characters) and restart, then try again.`
