import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Routes reachable without a session. There is no public sign-up. */
const PUBLIC_PATHS = ['/', '/login', '/auth/callback']

const isPublic = (path: string) =>
  PUBLIC_PATHS.includes(path) || path.startsWith('/auth/')

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthRoute = path === '/login'

  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    url.search = ''
    return NextResponse.redirect(url)
  }

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
