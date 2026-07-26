/** Server-only checks on the service-role key. Never import from client code. */

export type ServiceKeyState =
  | { status: 'missing' }
  | { status: 'ok' }
  /** Modern `sb_secret_…` keys carry no claims, so the project cannot be read from them. */
  | { status: 'unverifiable' }
  | { status: 'expired'; expiredOn: string }
  | { status: 'wrong-project'; keyRef: string; urlRef: string }

/** The project ref embedded in a Supabase URL: https://<ref>.supabase.co */
function refFromUrl(url: string): string | null {
  return /^https:\/\/([a-z0-9]+)\.supabase\./i.exec(url)?.[1] ?? null
}

/**
 * Read a JWT's claims without verifying its signature.
 *
 * Safe here because nothing is authorised on the result — the claims are only
 * used to tell the operator which project the key belongs to. A forged token
 * would fail against Supabase anyway.
 */
function claimsOf(token: string): { ref?: string; exp?: number } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * Whether the service-role key can actually act on this project.
 *
 * Presence is not enough. A key copied from a different Supabase project is a
 * perfectly well-formed JWT, so every "is it configured?" check passes while
 * every call it makes returns 401 "Invalid API key" — which surfaces as invites
 * silently falling back to signUp rather than as a configuration error. This
 * compares the project ref inside the key against the one in the URL so the
 * mismatch is reported as what it is.
 */
export function serviceKeyState(
  key = process.env.SUPABASE_SERVICE_ROLE_KEY,
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
): ServiceKeyState {
  if (!key || !url) return { status: 'missing' }

  const claims = claimsOf(key)
  if (!claims) return { status: 'unverifiable' }

  if (claims.exp && claims.exp * 1000 < Date.now()) {
    return { status: 'expired', expiredOn: new Date(claims.exp * 1000).toISOString().slice(0, 10) }
  }

  const urlRef = refFromUrl(url)
  if (claims.ref && urlRef && claims.ref !== urlRef) {
    return { status: 'wrong-project', keyRef: claims.ref, urlRef }
  }

  return { status: 'ok' }
}

/** True only when the key is usable, so callers can fall back deliberately. */
export function serviceKeyUsable(): boolean {
  const s = serviceKeyState().status
  return s === 'ok' || s === 'unverifiable'
}

/** One line for the admin console, naming the actual fault. */
export function describeServiceKey(state: ServiceKeyState): string {
  switch (state.status) {
    case 'missing':
      return 'Not set. Add SUPABASE_SERVICE_ROLE_KEY to frontend/.env.local and restart.'
    case 'wrong-project':
      return `Belongs to project "${state.keyRef}", but this deployment points at "${state.urlRef}". Every call it makes returns 401. Copy the service_role key from the ${state.urlRef} project.`
    case 'expired':
      return `Expired on ${state.expiredOn}. Copy a current service_role key from the Supabase dashboard.`
    case 'unverifiable':
      return 'Set. This key format carries no project claim, so it could not be checked without calling the API.'
    case 'ok':
      return 'Set, and it matches this project.'
  }
}
