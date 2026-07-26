'use client'

import { useState } from 'react'

import { ExternalLink, KeyRound, Mail, ShieldCheck, Wrench } from 'lucide-react'
import SqlBlock from '@/components/SqlBlock'
import { Alert, PageHeader, Panel, Pill, Spinner } from '@/components/ui'
import { sendDiagnosticEmail } from '../actions'

const REPAIR_PATH = 'supabase/repair_broken_logins.sql'
const MIGRATION_PATH = 'supabase/migrations/20260721000000_finatt_full_schema.sql'

export interface DiagnosticsData {
  serviceKey: boolean
  /** Names the actual fault: missing, expired, or from another project. */
  serviceKeyDetail?: string
  email: boolean
  siteUrl: string
  sandboxSender: boolean
  aiModel: string
  aiConfigured: boolean
}

/**
 * Operational panel for the things that can only be fixed outside the app —
 * SQL that needs the Supabase editor, and environment keys that need a restart.
 *
 * These scripts were previously reachable only from the first-run setup guide,
 * which disappears once the migration succeeds. That left the login-repair fix
 * with no route in the UI at exactly the moment it was needed.
 */
export default function DiagnosticsSection({
  sql,
  diagnostics,
}: {
  sql: {
    migration: string | null
    repair: string | null
    loginTracking: string | null
    applyStep1: string | null
    applyStep2: string | null
    demoRoles: string | null
  }
  diagnostics: DiagnosticsData
}) {
  // Derived here rather than passed down, so the project ref never appears in
  // any payload sent to an HR or employee session.
  const projectRef =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1] ?? null
  const sqlEditorUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
    : 'https://supabase.com/dashboard'

  const authSettingsUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/auth/providers`
    : 'https://supabase.com/dashboard'

  return (
    <>
      <PageHeader
        title="Diagnostics"
        subtitle="Infrastructure and database detail"
        action={
          <a
            href={sqlEditorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >
            <ExternalLink size={14} /> Open SQL Editor
          </a>
        }
      />

      <div className="grid gap-4">
        <Panel
          title="Bring the database up to date"
          subtitle="Run these two, in order — everything else on this tab is optional"
        >
          <div className="space-y-4">
            <Alert tone="info">
              Step 1 must run <strong>on its own</strong> and finish before step 2.
              PostgreSQL refuses to use a newly added role value in the same
              transaction that created it, and the SQL editor runs a whole script as
              one transaction.
            </Alert>

            <div>
              <p className="mb-2 text-xs font-semibold">Step 1 — add the admin role</p>
              <SqlBlock
                sql={sql.applyStep1}
                path="supabase/APPLY_STEP_1.sql"
                label="Copy step 1"
                note="One line. Run it, wait for success, then do step 2."
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold">Step 2 — everything else</p>
              <SqlBlock
                sql={sql.applyStep2}
                path="supabase/APPLY_STEP_2.sql"
                label="Copy step 2"
                note="All remaining migrations in dependency order. Idempotent — safe on a partially-migrated database. Ends with a verification report."
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold">Step 3 — fix the demo accounts</p>
              <SqlBlock
                sql={sql.demoRoles}
                path="supabase/seed_demo_roles.sql"
                label="Copy demo roles"
                note="Sets admin@demo.com → admin, hr@demo.com → hr, employee@demo.com → employee, repairs missing sign-in identities, and reports the result."
              />
            </div>
          </div>
        </Panel>

        <Panel
          title="Repair broken sign-ins"
          subtitle="For accounts that fail with “Database error querying schema”"
        >
          <div className="space-y-3">
            <Alert tone="info">
              An account inserted straight into <code className="text-xs">auth.users</code>{' '}
              by raw SQL has no matching <code className="text-xs">auth.identities</code>{' '}
              row. GoTrue joins identities during the password grant, so sign-in returns
              HTTP 500 even though the password is correct — this is why{' '}
              <code className="text-xs">employee@demo.com</code> fails while{' '}
              <code className="text-xs">hr@demo.com</code> works.
            </Alert>

            <SqlBlock
              sql={sql.repair}
              path={REPAIR_PATH}
              label="Copy repair SQL"
              note="Rebuilds missing identities, confirms the demo emails, and backfills any missing profile and employee records. Safe to run repeatedly."
            />

            <p className="muted text-xs">
              Paste it into the SQL Editor and press Run. The final SELECT reports each
              account — <code className="text-xs">email_identities</code> and{' '}
              <code className="text-xs">employee_rows</code> should both be 1.
            </p>
          </div>
        </Panel>

        <Panel
          title="Sign-in tracking"
          subtitle="Adds the counters behind the sign-in activity view"
        >
          <SqlBlock
            sql={sql.loginTracking}
            path="supabase/migrations/20260723000000_login_tracking.sql"
            label="Copy login tracking SQL"
            note="Adds the sign-in counters this console reports on."
          />
        </Panel>

        <Panel title="Schema migration" subtitle="Already applied if the consoles show data">
          <SqlBlock
            sql={sql.migration}
            path={MIGRATION_PATH}
            label="Copy migration SQL"
            note="Idempotent — re-running it is safe and will not duplicate anything."
          />
        </Panel>

        <Panel
          title="Email deliverability"
          subtitle="Send yourself a test message to confirm the provider is wired up"
        >
          <EmailTester enabled={diagnostics.email} sandbox={diagnostics.sandboxSender} />
        </Panel>

        <Panel title="Environment" subtitle="What this deployment currently has configured">
          <dl className="space-y-3 text-sm">
            <Row
              icon={<KeyRound size={15} />}
              label="Service role key"
              ok={diagnostics.serviceKey}
              okText="Configured"
              badText="Missing or rejected"
              detail={
                diagnostics.serviceKeyDetail ??
                (diagnostics.serviceKey
                  ? 'HR can create employee logins that work immediately.'
                  : 'Employee logins fall back to signUp, which this project gates behind email confirmation.')
              }
            />
            <Row
              icon={<Mail size={15} />}
              label="Email (Resend)"
              ok={diagnostics.email}
              okText="Configured"
              badText="Not configured"
              detail={
                diagnostics.email
                  ? 'Invite and leave-decision emails will send.'
                  : 'Set RESEND_API_KEY and EMAIL_FROM to enable invite emails. Everything else works without them.'
              }
            />
            <Row
              icon={<Wrench size={15} />}
              label="AI assistant"
              ok={diagnostics.aiConfigured}
              okText={diagnostics.aiModel}
              badText="No GEMINI_API_KEY"
              detail={
                diagnostics.aiConfigured
                  ? `Using ${diagnostics.aiModel}. Override with GEMINI_MODEL if this model is retired.`
                  : 'The in-app assistant is disabled until GEMINI_API_KEY is set.'
              }
            />
            <Row
              icon={<ShieldCheck size={15} />}
              label="Site URL"
              ok
              okText={diagnostics.siteUrl}
              badText=""
              detail="Used to build links inside emails. Must match the deployed origin and be listed under Supabase → Authentication → URL Configuration."
            />
          </dl>

          <a
            href={authSettingsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm mt-4"
          >
            <ExternalLink size={14} /> Supabase auth settings
          </a>
        </Panel>
      </div>
    </>
  )
}

function EmailTester({ enabled, sandbox }: { enabled: boolean; sandbox: boolean }) {
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSending(true)
    setResult(null)

    const res = await sendDiagnosticEmail(new FormData(e.currentTarget))
    setResult(
      res.ok
        ? { ok: true, message: `Sent. Check the inbox${res.data.id ? ` (id ${res.data.id})` : ''}.` }
        : { ok: false, message: res.error },
    )
    setSending(false)
  }

  if (!enabled) {
    return (
      <Alert tone="warning">
        No email provider is configured, so invites cannot be sent. Set RESEND_API_KEY and
        EMAIL_FROM in the server environment and restart.
      </Alert>
    )
  }

  return (
    <div className="space-y-3">
      {sandbox && (
        <Alert tone="warning">
          This deployment sends from <code className="text-xs">onboarding@resend.dev</code>,
          Resend&apos;s sandbox address. It only delivers to the address that owns the
          Resend account — invites to any other employee will be rejected with a 403.
          Verify a domain at resend.com/domains and point EMAIL_FROM at it before
          onboarding real staff.
        </Alert>
      )}

      <form onSubmit={handleSend} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="test-email-to">
            Send a test to
          </label>
          <input
            id="test-email-to"
            name="to"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Defaults to your own address"
            className="field"
          />
        </div>
        <button type="submit" disabled={sending} className="btn btn-primary">
          {sending ? <Spinner size={16} /> : <Mail size={16} />} Send test
        </button>
      </form>

      {result && <Alert tone={result.ok ? 'success' : 'error'}>{result.message}</Alert>}
    </div>
  )
}

function Row({
  icon,
  label,
  ok,
  okText,
  badText,
  detail,
}: {
  icon: React.ReactNode
  label: string
  ok: boolean
  okText: string
  badText: string
  detail: string
}) {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
      <span className="muted mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="font-medium">{label}</dt>
          <Pill tone={ok ? 'var(--success)' : 'var(--warning)'}>{ok ? okText : badText}</Pill>
        </div>
        <dd className="muted mt-1 text-xs">{detail}</dd>
      </div>
    </div>
  )
}

