import { type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

/**
 * Next 16 renamed the `middleware` convention to `proxy`. Same behaviour, but
 * the runtime is always Node — the edge runtime is not supported here.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Everything except:
     * - api routes (they do their own auth)
     * - _next internals (static chunks, HMR)
     * - models / mediapipe (face weights and WASM; large, public, and needed
     *   before the user is signed in on the enrollment screen)
     * - files with a static extension
     */
    '/((?!api|_next|models|mediapipe|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff|woff2|ttf|eot|ico|bin|json|wasm|task)$).*)',
  ],
}
