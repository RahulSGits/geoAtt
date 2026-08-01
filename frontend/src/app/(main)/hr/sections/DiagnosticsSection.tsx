'use client'

import { useState } from 'react'

import { ExternalLink, KeyRound, Mail, ShieldCheck, Wrench } from 'lucide-react'
import SqlBlock from '@/components/SqlBlock'
import { Alert, PageHeader, Panel, Pill, Spinner } from '@/components/ui'
import { sendDiagnosticEmail } from '../actions'

/**
 * Paths shown next to each SQL block.
 *
 * They point at `db/`, the schema this app actually runs against. They used to
 * point at `supabase/` — the previous project's migrations — which was worse
 * than stale: pasting those into the current project fails with
 * `42703: column "email" does not exist`, because the old schema assumes a
 * column layout the new one arranges differently. Anyone following this tab in
 * good faith was handed SQL that could not work.
 */
const SCHEMA_PATH = 'db/apply-all.sql'
const COMPAT_PATH = 'db/RUN-THIS-NOW.sql'

export interface DiagnosticsData {
  serviceKey: boolean
  /** Names the actual fault: missing, expired, or from another project. */
  serviceKeyDetail?: string
  email: boolean
  /** Whether ONBOARDING_PASSWORD is set and long enough. */
  onboardingPassword: boolean
  /** Names the fault when it is not: unset, or too short. */
  onboardingPasswordDetail?: string
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
    /** db/apply-all.sql — the whole schema, for a fresh project. */
    schema: string | null
    /** db/RUN-THIS-NOW.sql — the compatibility migration, 0014. */
    compat: string | null
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
          subtitle="Run the compatibility migration first — it is the usual fix"
        >
          <div className="space-y-4">
            <Alert tone="info">
              Paste <strong>only</strong> the SQL below. Anything under{' '}
              <code className="text-xs">supabase/</code> belongs to the previous
              project and will fail against this schema.
            </Alert>

            <div>
              <p className="mb-2 text-xs font-semibold">
                Fixes “column employees_1.full_name does not exist”
              </p>
              <SqlBlock
                sql={sql.compat}
                path={COMPAT_PATH}
                label="Copy the fix"
                note="Restores the column set this app reads, and keeps profiles and employees in step with triggers. Idempotent — safe to re-run."
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold">
                Only for an empty project — the entire schema
              </p>
              <SqlBlock
                sql={sql.schema}
                path={SCHEMA_PATH}
                label="Copy full schema"
                note="Every table, view, function, policy and bucket in dependency order. Idempotent, so it is also safe over a partial database."
              />
            </div>
          </div>
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
              icon={<KeyRound size={15} />}
              label="Onboarding password"
              ok={diagnostics.onboardingPassword}
              okText="Configured"
              badText="Not set"
              detail={
                diagnostics.onboardingPasswordDetail ??
                'New HR and employee accounts start on this. Rotate it by changing ONBOARDING_PASSWORD and restarting.'
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

