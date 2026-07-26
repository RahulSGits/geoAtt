'use client'

import { TriangleAlert } from 'lucide-react'

/**
 * Shown to HR when the database schema is still un-migrated.
 *
 * Deliberately contains no SQL, no file paths and no Supabase project
 * reference: HR is not the audience for database internals. The scripts and the
 * SQL-editor deep link live on the admin console's Diagnostics tab.
 */
export default function SetupGuide() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="card p-6 text-center">
        <span
          className="mx-auto grid h-12 w-12 place-items-center rounded-2xl"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
        >
          <TriangleAlert size={22} />
        </span>
        <h2 className="mt-4 text-lg font-semibold">Setup isn&apos;t finished</h2>
        <p className="muted mt-2 text-sm">
          The workforce database hasn&apos;t been initialised yet, so there is nothing to
          show here. Your administrator needs to complete setup from the admin console.
        </p>
        <p className="muted mt-4 text-xs">
          Everything else in the app is running normally.
        </p>
      </div>
    </div>
  )
}
