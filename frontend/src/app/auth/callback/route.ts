import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'

/** The link types this app actually issues, from admin.generateLink. */
const OTP_TYPES: EmailOtpType[] = ['invite', 'recovery', 'email', 'magiclink', 'signup']

/**
 * Turns an invite or reset link into a session, then routes the user onward.
 *
 * Two flows are accepted, and the token-hash one is what this app actually
 * produces:
 *
 *  - `?token_hash=…&type=…` — verified with verifyOtp. `admin.generateLink`
 *    returns `hashed_token`, and the invite/reset emails are built from it.
 *
 *  - `?code=…` — the PKCE exchange. Kept only for a future OAuth or
 *    `resetPasswordForEmail` flow. It cannot succeed for the links this app
 *    sends today: @supabase/ssr hardcodes `flowType: 'pkce'`, and auth-js
 *    throws AuthPKCECodeVerifierMissingError unless the SAME BROWSER started
 *    the flow and stored a `…-code-verifier` cookie. Nothing here ever does.
 *
 * That mismatch is why every invite and every "Send reset link" previously
 * dead-ended at /login?error=missing_code: GoTrue's own verify endpoint returns
 * its tokens in the URL *fragment*, so no `code` query param ever arrived, and
 * the login page does not render the error either.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const rawType = searchParams.get('type')

  const supabase = await createClient()

  if (tokenHash) {
    const type = OTP_TYPES.includes(rawType as EmailOtpType)
      ? (rawType as EmailOtpType)
      : 'invite'

    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (error) {
      console.error('[auth/callback] verifyOtp failed:', error.message)
      return NextResponse.redirect(`${origin}/login?error=invalid_link`)
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[auth/callback] code exchange failed:', error.message)
      return NextResponse.redirect(`${origin}/login?error=invalid_link`)
    }
  } else {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.redirect(`${origin}/login`)

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, password_created')
    .eq('id', user.id)
    .maybeSingle<{ role: string; password_created: boolean | null }>()

  if (profile?.password_created === false) {
    return NextResponse.redirect(`${origin}/set-password`)
  }

  const role = profile?.role ?? user.user_metadata?.role ?? 'employee'
  return NextResponse.redirect(`${origin}${safeNext(searchParams.get('next'), role)}`)
}

/**
 * Only ever redirect to a path on this site.
 *
 * `next` arrives from the URL, so accepting it verbatim would let a crafted
 * link bounce a freshly-authenticated user to an attacker's page. Anything
 * that isn't a single-slash relative path falls back to the role's dashboard.
 */
function safeNext(next: string | null, role: string): string {
  const fallback = role === 'admin' ? '/admin' : role === 'hr' ? '/hr' : '/employee'
  if (!next) return fallback
  // Rejects absolute URLs ("https://evil.com") and protocol-relative ("//evil.com").
  if (!next.startsWith('/') || next.startsWith('//')) return fallback
  return next
}
