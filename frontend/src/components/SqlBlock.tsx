'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Alert } from './ui'

/**
 * Copy button for a SQL script, with a path fallback when the file could not be
 * read from disk.
 *
 * Copies the SQL *contents*, never the file path — an earlier version offered
 * "Copy path", which got pasted into the Supabase SQL editor and produced
 * `42601: syntax error at or near "supabase"`.
 */
export default function SqlBlock({
  sql,
  path,
  note,
  label = 'Copy SQL',
}: {
  sql: string | null
  path: string
  note?: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!sql) return
    try {
      await navigator.clipboard.writeText(sql)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  if (!sql) {
    return (
      <Alert tone="warning">
        Couldn&apos;t read the file from here. Open <code className="text-xs">{path}</code>{' '}
        in your editor and paste its contents — the whole file, not the path.
      </Alert>
    )
  }

  const lines = sql.split('\n').length

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={copy} className="btn btn-primary btn-sm">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied — now paste and Run' : label}
        </button>
        <span className="muted text-xs tabular-nums">
          {lines} lines · {(sql.length / 1024).toFixed(1)} KB
        </span>
      </div>

      <details className="rounded-lg border border-[var(--border)]">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Preview SQL</summary>
        <pre className="max-h-56 overflow-auto border-t border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px] leading-relaxed">
          <code>{sql}</code>
        </pre>
      </details>

      {note && <p className="muted text-xs">{note}</p>}
    </div>
  )
}
