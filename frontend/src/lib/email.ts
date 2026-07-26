/**
 * Transactional email via Resend.
 *
 * Server-only — never import from a client component, it reads the API key.
 *
 * Uses the REST endpoint directly rather than the SDK: it is one POST, and it
 * keeps the dependency surface (and cold-start cost) at zero.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/**
 * Resend's shared sandbox sender. It needs no domain verification, but it will
 * ONLY deliver to the address that owns the Resend account — any other
 * recipient is rejected with 403. Fine for a smoke test, useless for inviting
 * real staff, so callers are told exactly that rather than seeing a raw 403.
 */
const SANDBOX_FROM = 'onboarding@resend.dev'

export function usingSandboxSender(): boolean {
  return (process.env.EMAIL_FROM ?? '').includes(SANDBOX_FROM)
}

export const SANDBOX_WARNING =
  'You are sending from onboarding@resend.dev, Resend\'s sandbox address. It only ' +
  'delivers to the email that owns your Resend account — invites to anyone else will ' +
  'be rejected. Verify a domain at resend.com/domains and set EMAIL_FROM to an address ' +
  'on it before onboarding real employees.'

export interface SendResult {
  ok: boolean
  error?: string
  id?: string
}

/** Whether email is configured at all, so callers can degrade instead of failing. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

export const EMAIL_SETUP_HELP =
  'Email is not configured. Add RESEND_API_KEY and EMAIL_FROM to frontend/.env.local ' +
  '(get a key at resend.com/api-keys, and use a verified sending domain), then restart the server.'

async function send(payload: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  if (!apiKey || !from) return { ok: false, error: EMAIL_SETUP_HELP }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    })

    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      // Resend puts the useful detail in `message`; surface it rather than a bare status.
      const detail: string = body?.message || `Email provider returned ${res.status}.`

      // The sandbox rejection is by far the most common first failure, and its
      // raw wording does not say what to do about it.
      if (res.status === 403 && /testing emails|own email address/i.test(detail)) {
        return { ok: false, error: `${detail} ${SANDBOX_WARNING}` }
      }
      if (res.status === 401 || /api key/i.test(detail)) {
        return {
          ok: false,
          error: 'The email provider rejected the API key. Check RESEND_API_KEY and restart the server.',
        }
      }

      return { ok: false, error: detail }
    }

    return { ok: true, id: body?.id }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not reach the email provider.',
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Templates                                                                  */
/* ------------------------------------------------------------------------- */

const BRAND = '#1e40af'

/**
 * Table-based layout with inline styles — Outlook and several webmail clients
 * strip <style> blocks and don't implement flex/grid, so anything else breaks.
 */
function shell(heading: string, body: string, cta?: { label: string; url: string }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #d8e0ec;">
      <tr>
        <td style="padding:28px 32px 8px;">
          <div style="font-size:18px;font-weight:700;color:${BRAND};letter-spacing:-0.2px;">FinAtt</div>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 32px 0;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0f172a;">${heading}</h1>
          <div style="font-size:15px;line-height:1.6;color:#556274;">${body}</div>
        </td>
      </tr>
      ${
        cta
          ? `<tr>
        <td style="padding:24px 32px 8px;">
          <a href="${cta.url}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">${cta.label}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 32px 0;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7889;">
            If the button doesn't work, paste this into your browser:<br>
            <span style="color:${BRAND};word-break:break-all;">${cta.url}</span>
          </p>
        </td>
      </tr>`
          : ''
      }
      <tr>
        <td style="padding:24px 32px 28px;">
          <hr style="border:none;border-top:1px solid #d8e0ec;margin:0 0 16px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7889;">
            FinAtt — Attendance &amp; Workforce Management.<br>
            If you weren't expecting this email you can safely ignore it.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** Invite an employee to set their password and activate their account. */
export function sendInviteEmail(opts: {
  to: string
  name: string
  link: string
  invitedBy?: string
  /** Present when the account starts on the shared default password. */
  defaultPassword?: string
}): Promise<SendResult> {
  const greeting = opts.name ? `Hi ${escapeHtml(opts.name)},` : 'Hi,'
  const by = opts.invitedBy ? ` by ${escapeHtml(opts.invitedBy)}` : ''

  if (opts.defaultPassword) {
    const pw = escapeHtml(opts.defaultPassword)
    return send({
      to: opts.to,
      subject: 'Your FinAtt account is ready',
      html: shell(
        'Your FinAtt account is ready',
        `<p style="margin:0 0 12px;">${greeting}</p>
         <p style="margin:0 0 12px;">You've been added to FinAtt${by}. Sign in with your email address and this temporary password:</p>
         <p style="margin:0 0 12px;font-family:ui-monospace,Menlo,monospace;font-size:16px;font-weight:600;">${pw}</p>
         <p style="margin:0;">Change it from <strong>My Profile</strong> once you are in. You get one change, so pick something you will remember — after that an administrator has to reset it for you.</p>`,
        { label: 'Sign in', url: opts.link },
      ),
      text: `${greeting}\n\nYou've been added to FinAtt${by ? ` by ${opts.invitedBy}` : ''}.\n\nSign in at ${opts.link} with your email address and this temporary password:\n\n  ${opts.defaultPassword}\n\nChange it from My Profile once you are in. You get one change — after that an administrator has to reset it for you.\n\n— FinAtt`,
    })
  }

  return send({
    to: opts.to,
    subject: 'Set up your FinAtt account',
    html: shell(
      'Your FinAtt account is ready',
      `<p style="margin:0 0 12px;">${greeting}</p>
       <p style="margin:0 0 12px;">You've been added to FinAtt${by}. Set a password to activate your account, then you can check in, view your attendance and request leave.</p>
       <p style="margin:0;">This link expires in 24 hours.</p>`,
      { label: 'Set my password', url: opts.link },
    ),
    text: `${greeting}\n\nYou've been added to FinAtt${by ? ` by ${opts.invitedBy}` : ''}. Set your password here (link expires in 24 hours):\n\n${opts.link}\n\n— FinAtt`,
  })
}

/** One-off deliverability check, triggered from the admin console. */
export function sendTestEmail(to: string): Promise<SendResult> {
  return send({
    to,
    subject: 'FinAtt email is working',
    html: shell(
      'Email is configured correctly',
      `<p style="margin:0 0 12px;">This is a test message from your FinAtt deployment.</p>
       <p style="margin:0;">Invite and leave-decision emails will be delivered the same way.</p>`,
    ),
    text: 'This is a test message from your FinAtt deployment. Email is configured correctly.',
  })
}

/** Notify an employee that HR decided on their leave request. */
export function sendLeaveDecisionEmail(opts: {
  to: string
  name: string
  decision: 'approved' | 'rejected'
  leaveType: string
  startDate: string
  endDate: string
  note?: string | null
  appUrl: string
}): Promise<SendResult> {
  const approved = opts.decision === 'approved'
  const heading = approved ? 'Your leave was approved' : 'Your leave request was declined'

  return send({
    to: opts.to,
    subject: `${opts.leaveType} leave ${opts.decision}`,
    html: shell(
      heading,
      `<p style="margin:0 0 12px;">Hi ${escapeHtml(opts.name)},</p>
       <p style="margin:0 0 12px;">Your <strong>${escapeHtml(opts.leaveType)}</strong> leave from
       <strong>${escapeHtml(opts.startDate)}</strong> to <strong>${escapeHtml(opts.endDate)}</strong>
       was <strong>${opts.decision}</strong>.</p>
       ${opts.note ? `<p style="margin:0 0 12px;padding:12px;background:#f5f7fb;border-radius:8px;">${escapeHtml(opts.note)}</p>` : ''}`,
      { label: 'Open FinAtt', url: `${opts.appUrl}/employee` },
    ),
    text: `Hi ${opts.name},\n\nYour ${opts.leaveType} leave from ${opts.startDate} to ${opts.endDate} was ${opts.decision}.${opts.note ? `\n\nNote: ${opts.note}` : ''}\n\n${opts.appUrl}/employee`,
  })
}

/** Values are interpolated into HTML, so anything user-supplied must be escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Send someone a link to choose a new password. */
export function sendPasswordResetEmail(opts: {
  to: string
  name: string
  link: string
  resetBy?: string
}): Promise<SendResult> {
  const greeting = opts.name ? `Hi ${escapeHtml(opts.name)},` : 'Hi,'
  const by = opts.resetBy ? ` by ${escapeHtml(opts.resetBy)}` : ''

  return send({
    to: opts.to,
    subject: 'Reset your FinAtt password',
    html: shell(
      'Choose a new password',
      `<p style="margin:0 0 12px;">${greeting}</p>
       <p style="margin:0 0 12px;">A password reset was requested for your FinAtt account${by}. Follow the link to choose a new one.</p>
       <p style="margin:0;">This link expires in 24 hours. If you did not expect this, you can ignore this email — your current password stays active until the link is used.</p>`,
      { label: 'Choose a new password', url: opts.link },
    ),
    text: `${greeting}\n\nA password reset was requested for your FinAtt account${by ? ` by ${opts.resetBy}` : ''}. Choose a new password here (expires in 24 hours):\n\n${opts.link}\n\nIf you did not expect this, ignore this email.\n\n— FinAtt`,
  })
}
