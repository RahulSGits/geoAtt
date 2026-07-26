/**
 * Accounts that may not be demoted, deleted, or have their password reset by
 * anyone — including another administrator.
 *
 * The list lives in the PROTECTED_ACCOUNTS environment variable, comma or
 * space separated, rather than in this file. Two reasons: the repository is
 * public, so a hard-coded address would publish someone's personal email; and
 * the set of protected accounts differs per deployment, which is configuration,
 * not code.
 *
 *   PROTECTED_ACCOUNTS="owner@company.com, second-owner@company.com"
 *
 * This is a lock against accident and against a compromised second admin. It is
 * NOT a substitute for the last-administrator rule, which still applies: both
 * run, and either one can refuse.
 *
 * Server-only. The variable is deliberately not NEXT_PUBLIC_, so the list never
 * reaches the browser; the UI learns which rows are locked from listMembers.
 */

let cached: Set<string> | null = null

function load(): Set<string> {
  if (cached) return cached
  cached = new Set(
    (process.env.PROTECTED_ACCOUNTS ?? '')
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )
  return cached
}

/** True when this email address is locked against role changes and deletion. */
export function isProtectedAccount(email: string | null | undefined): boolean {
  if (!email) return false
  return load().has(email.trim().toLowerCase())
}

/** How many accounts are locked. Used by Diagnostics to show the rule is on. */
export function protectedAccountCount(): number {
  return load().size
}
