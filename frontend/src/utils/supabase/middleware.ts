import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Routes reachable without a session. There is no public sign-up. */
const PUBLIC_PATHS = ['/', '/login', '/auth/callback']

const isPublic = (path: string) =>
  PUBLIC_PATHS.includes(path) || path.startsWith('/auth/')

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const path = request.nextUrl.pathname

  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    url.search = ''
    return NextResponse.redirect(url)
  }

  /**
   * Config check, before anything can throw.
   *
   * These used to be read with `!`, which is an assertion to the compiler and
   * nothing at runtime. When a variable is missing or misspelled in the hosting
   * environment they are `undefined`, `createServerClient(undefined, undefined)`
   * throws — and because this runs as middleware on every matched route, that
   * single exception returned a bare "Internal Server Error" for the entire
   * site, /login included. There was no way in from a browser and no clue why.
   *
   * Now it degrades instead: public routes still render, protected ones send
   * you to /login, and the log names the exact variable to fix. A
   * misconfiguration should cost you the signed-in area, not the whole site.
   */
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    const missing = [
      !url && 'NEXT_PUBLIC_SUPABASE_URL',
      !key && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ].filter(Boolean)

    console.error(
      `[proxy] Supabase is not configured — missing ${missing.join(' and ')}. ` +
        'Set it in the hosting environment and redeploy; env vars are read at ' +
        'build time, so an existing deployment will not pick up a new value. ' +
        'Names are matched exactly — a misspelling reads as undefined.',
    )
    return isPublic(path) ? supabaseResponse : redirectTo('/login')
  }

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refreshes the session if it has expired.
  //
  // Guarded because this is a network call. An unreachable project, a DNS
  // blip or a paused Supabase instance rejects rather than returning an
  // error field, and an unhandled rejection in middleware is a 500 for every
  // route at once. Treating a failure as "no session" costs a signed-in user
  // a redirect to /login; letting it throw costs everyone the site.
  const result = await supabase.auth.getUser().catch((err: unknown) => {
    console.error(
      '[proxy] Supabase auth unreachable:',
      err instanceof Error ? err.message : err,
    )
    return null
  })

  if (result === null) {
    return isPublic(path) ? supabaseResponse : redirectTo('/login')
  }

  const user = result.data.user
  const isAuthRoute = path === '/login'

  if (!user) {
    return isPublic(path) ? supabaseResponse : redirectTo('/login')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, password_created')
    .eq('id', user.id)
    .maybeSingle<{ role: string; password_created: boolean | null }>()

  if (error) {
    console.warn('[proxy] profile lookup failed, using metadata fallback:', error.message)
  }

  // A successful lookup that found nothing means the account was deleted (or
  // never provisioned). Send them to /login rather than letting the metadata
  // fallback below hand them their old role: getSession() treats this as signed
  // out, so without the same rule here the proxy would admit them to a portal
  // and the page would then throw instead of redirecting cleanly.
  if (!profile && !error) {
    return isPublic(path) ? supabaseResponse : redirectTo('/login')
  }

  const role = profile?.role ?? user.user_metadata?.role ?? 'employee'
  const passwordCreated =
    profile?.password_created ?? user.user_metadata?.password_created ?? true
  const home = role === 'admin' ? '/admin' : role === 'hr' ? '/hr' : '/employee'

  // An invited user must finish setting a password before anything else.
  if (passwordCreated === false && path !== '/set-password' && !path.startsWith('/auth/')) {
    return redirectTo('/set-password')
  }

  if (isAuthRoute) {
    return redirectTo(passwordCreated === false ? '/set-password' : home)
  }

  // Portal access. Admin may enter the HR console too (superset); HR may not
  // enter /admin. Employees only ever see their own portal.
  if (path.startsWith('/admin') && role !== 'admin') return redirectTo(home)
  if (path.startsWith('/hr') && !(role === 'hr' || role === 'admin')) return redirectTo(home)
  if (path.startsWith('/employee') && role !== 'employee') return redirectTo(home)

  return supabaseResponse
}
