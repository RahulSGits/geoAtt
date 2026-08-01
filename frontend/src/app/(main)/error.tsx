'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Error boundary for the signed-in portals.
 *
 * Without one, any throw inside /employee, /hr or /admin fell through to
 * Next's built-in page — an unstyled "This page couldn't load" with no
 * indication of what broke or whether the rest of the app still worked. A
 * schema drift on one section blanked the entire route.
 *
 * The message is shown rather than hidden. This is an internal tool for one
 * company, not a public site: there is no attacker to leak a table name to,
 * and "column employees_1.full_name does not exist" is the single most useful
 * sentence for whoever has to fix it. `digest` is the id in the server logs.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[portal] route error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>

      <h1 className="mt-5 text-xl font-semibold text-slate-900">
        This section could not load
      </h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
        The rest of the console still works — use the menu to carry on elsewhere.
      </p>

      {error.message && (
        <pre className="mt-5 max-w-xl overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs leading-5 text-slate-700">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Go back
        </Link>
      </div>
    </div>
  )
}
