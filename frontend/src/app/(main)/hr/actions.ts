'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'
import { AuthError, requireRole, type Session } from '@/lib/auth'
import { requirePassword } from '@/lib/reauth'
import {
  emailConfigured,
  EMAIL_SETUP_HELP,
  sendInviteEmail,
  sendLeaveDecisionEmail,
  sendPasswordResetEmail,
  sendTestEmail,
  usingSandboxSender,
} from '@/lib/email'
import { DEFAULT_PASSWORD, MIN_PASSWORD_LENGTH } from '@/lib/types'
import type { ActionResult } from '@/lib/types'

function fail(error: string): ActionResult<never> {
  return { ok: false, error }
}

function toResult(err: unknown): ActionResult<never> {
  if (err instanceof AuthError) return fail(err.message)
  console.error('[hr action]', err)
  return fail(err instanceof Error ? err.message : 'Something went wrong.')
}

function refresh() {
  revalidatePath('/hr')
  revalidatePath('/employee')
}

/**
 * Notify an employee that HR changed something of theirs.
 *
 * Best-effort: a notification is a courtesy, never a reason to fail the action
 * that triggered it. Keyed to the employee's *user* id (the notifications
 * recipient), which only exists once they have signed up.
 */
async function notifyEmployee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  title: string,
  body: string,
  kind: 'info' | 'success' | 'warning' = 'info',
): Promise<void> {
  try {
    const { data: emp } = await supabase
      .from('employees')
      .select('user_id')
      .eq('id', employeeId)
      .maybeSingle<{ user_id: string | null }>()

    if (!emp?.user_id) return

    const { error } = await supabase.from('notifications').insert({
      recipient_id: emp.user_id,
      title,
      body,
      kind,
    })
    if (error && !/could not find the table|notifications/i.test(error.message)) {
      console.warn('[notify] insert failed:', error.message)
    }
  } catch (err) {
    console.warn('[notify] skipped:', err instanceof Error ? err.message : err)
  }
}

/** A "work from home" leave request, matched loosely on the type text. */
import { describeServiceKey, serviceKeyState, serviceKeyUsable } from '@/lib/serviceKey'

function isWfhLeave(leaveType: string): boolean {
  return /work\s*from\s*home|wfh|remote/i.test(leaveType)
}

/**
 * Service-role client for the two operations that genuinely need to bypass RLS:
 * inviting a user and writing their employee row before they have a session.
 * Returns null when the key is absent so callers can explain the gap instead of
 * throwing an opaque "Invalid API key".
 */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  // A key from another project is well-formed but 401s on every call, which
  // would surface as a confusing invite failure. Fall back deliberately instead.
  if (!serviceKeyUsable()) {
    console.warn('[admin] service key unusable:', describeServiceKey(serviceKeyState()))
    return null
  }
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Absolute origin used to build links inside emails. */
function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/**
 * Build the emailed link from generateLink's `hashed_token`, pointing at our own
 * callback rather than GoTrue's.
 *
 * `properties.action_link` -- the obvious thing to email -- goes to GoTrue's
 * /auth/v1/verify, which returns the session in the URL *fragment*. A fragment
 * never reaches the server, so our callback saw no token at all and bounced
 * every invite and reset to /login?error=missing_code. Sending the token_hash
 * as a query parameter lets the callback verify it server-side with verifyOtp,
 * which is the flow @supabase/ssr actually supports.
 */
function confirmLink(hashedToken: string, type: 'invite' | 'recovery'): string {
  const next = type === 'recovery' ? '/set-password' : '/set-password'
  return (
    `${siteUrl()}/auth/callback` +
    `?token_hash=${encodeURIComponent(hashedToken)}` +
    `&type=${type}` +
    `&next=${encodeURIComponent(next)}`
  )
}

/**
 * HR-facing wording only. The specific env var and dashboard path are
 * infrastructure detail and live on the admin console's Diagnostics tab; naming
 * them here would put them in an HR user's payload.
 */
const SERVICE_KEY_HELP =
  'Invite emails are not enabled on this deployment yet. Your administrator can turn them on from the admin console. In the meantime, create a login for this employee directly, or ask them to register with their work email.'

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

/** Shape accepted by both the single-employee form and the CSV importer. */
interface EmployeeInput {
  email: string
  fullName: string
  /** CSV only. Blank lets the importer allocate the next EMP-000n. */
  employeeId?: string
  /** CSV only. The portal to grant when a login is later created. */
  role?: string
  phone?: string
  department?: string
  designation?: string
  joiningDate?: string
  gender?: string
  address?: string
  siteId?: string
  shiftId?: string
}

/**
 * A usable employee code.
 *
 * Deliberately permissive. FinAtt generates `EMP-0001`, but an imported roster
 * carries whatever the previous system used — `ND33004`, `2024/117`, `E_88` —
 * and rejecting those made the importer refuse entire files for no good reason.
 * The only real requirements are that a code is short, has no whitespace (it is
 * matched and compared as a key), and holds nothing that would break a CSV
 * round-trip or an HTML render.
 */
const EMPLOYEE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/

function readEmployeeInput(formData: FormData): EmployeeInput {
  return {
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    fullName: String(formData.get('fullName') ?? '').trim(),
    phone: String(formData.get('phone') ?? '').trim(),
    department: String(formData.get('department') ?? '').trim(),
    designation: String(formData.get('designation') ?? '').trim(),
    joiningDate: String(formData.get('joiningDate') ?? ''),
    gender: String(formData.get('gender') ?? ''),
    address: String(formData.get('address') ?? '').trim(),
    siteId: String(formData.get('siteId') ?? ''),
    shiftId: String(formData.get('shiftId') ?? ''),
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Next sequential employee code, e.g. EMP-0007. */
async function nextEmployeeCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  offset = 0,
): Promise<string> {
  const { data } = await supabase
    .from('employees')
    .select('employee_id')
    .order('employee_id', { ascending: false })
    .limit(1)
    .maybeSingle<{ employee_id: string }>()

  const highest = Number((data?.employee_id ?? '').replace(/\D/g, '')) || 0
  return `EMP-${String(highest + 1 + offset).padStart(4, '0')}`
}

/**
 * Create an employee record.
 *
 * Deliberately does NOT require the service_role key: the row is written
 * straight to `employees` with a null user_id, which HR's own RLS policy
 * permits. When that person later signs up with the same address, the
 * handle_new_profile trigger adopts the row. Sending the invite email is a
 * separate, optional step so a missing key or SMTP outage cannot block
 * onboarding.
 */
export async function createEmployee(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()
    const input = readEmployeeInput(formData)

    if (!input.fullName) return fail('Enter the employee\'s full name.')
    if (!EMAIL_RE.test(input.email)) return fail('Enter a valid email address.')

    const { data: clash } = await supabase
      .from('employees')
      .select('id')
      .ilike('email', input.email)
      .maybeSingle<{ id: string }>()

    if (clash) return fail('An employee with that email already exists.')

    const { error } = await supabase.from('employees').insert({
      employee_id: await nextEmployeeCode(supabase),
      full_name: input.fullName,
      email: input.email,
      phone: input.phone || null,
      department: input.department || null,
      designation: input.designation || null,
      joining_date: input.joiningDate || null,
      gender: input.gender || null,
      address: input.address || null,
      site_id: input.siteId || null,
      shift_id: input.shiftId || null,
      status: 'active',
    })

    if (error) return fail(error.message)

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

/**
 * Create a sign-in account for an employee who does not have one yet, and hand
 * HR a temporary password to pass on.
 *
 * Two routes, because they degrade differently:
 *
 *  - service_role present -> `admin.createUser({ email_confirm: true })`. The
 *    account is usable immediately, no email involved.
 *  - otherwise -> plain `signUp()` on a cookie-less client, which needs only the
 *    publishable key. The account is created but Supabase requires the employee
 *    to confirm by email first (this project has mailer_autoconfirm off), so we
 *    say so rather than handing over a password that will not work yet.
 *
 * A cookie-less client is essential: the SSR client would write the new user's
 * tokens into HR's own cookies and sign HR out of their own console.
 */
export async function createEmployeeLogin(
  formData: FormData,
): Promise<ActionResult<{ email: string; password: string; needsConfirmation: boolean }>> {
  try {
    const session = await requireRole('hr')
    const supabase = await createClient()

    const employeeId = String(formData.get('employeeId') ?? '')
    if (!employeeId) return fail('Missing employee.')

    const { data: employee, error: lookupError } = await supabase
      .from('employees')
      .select('id, email, full_name, user_id, department, designation, phone')
      .eq('id', employeeId)
      .maybeSingle<{
        id: string
        email: string
        full_name: string
        user_id: string | null
        department: string | null
        designation: string | null
        phone: string | null
      }>()

    if (lookupError) return fail(lookupError.message)
    if (!employee) return fail('That employee no longer exists.')
    if (employee.user_id) {
      return fail(`${employee.full_name} already has an account. Send a password reset instead.`)
    }

    const supplied = String(formData.get('password') ?? '')
    const password = supplied.length >= 8 ? supplied : generatePassword()

    // Always an employee account. Granting HR or admin is a separate, explicit
    // act -- an administrator changes the portal from Members & access, where
    // set_member_role enforces the rule in Postgres. Deriving it from a roster
    // field here would let a CSV decide who is an administrator.
    void session

    const metadata = {
      full_name: employee.full_name,
      role: 'employee',
      phone: employee.phone ?? '',
      department: employee.department ?? '',
      designation: employee.designation ?? '',
      account_status: 'active',
      // Forces /set-password on first sign-in so the temporary one is replaced.
      password_created: false,
    }

    const admin = adminClient()

    if (admin) {
      const { error } = await admin.auth.admin.createUser({
        email: employee.email,
        password,
        email_confirm: true,
        user_metadata: metadata,
      })

      if (error) {
        return fail(
          /invalid api key/i.test(error.message) ? SERVICE_KEY_HELP : error.message,
        )
      }

      refresh()
      return { ok: true, data: { email: employee.email, password, needsConfirmation: false } }
    }

    // Fallback: no service key. `signUp` only needs the publishable key.
    const anon = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data, error } = await anon.auth.signUp({
      email: employee.email,
      password,
      options: { data: metadata, emailRedirectTo: `${siteUrl()}/auth/callback` },
    })

    if (error) {
      return fail(
        /already registered/i.test(error.message)
          ? 'An account already exists for that email address.'
          : error.message,
      )
    }

    refresh()
    return {
      ok: true,
      data: {
        email: employee.email,
        password,
        // No session back means Supabase is holding the account for confirmation.
        needsConfirmation: !data.session,
      },
    }
  } catch (err) {
    return toResult(err)
  }
}

/**
 * Readable but high-entropy temporary password: ~62 bits, no ambiguous glyphs
 * (0/O, 1/l/I) so it survives being read aloud or copied off a screen.
 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint32Array(12)
  crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`
}

/** Bulk-create employees from a parsed CSV. Partial success is reported, not thrown. */
export async function importEmployees(
  rows: EmployeeInput[],
): Promise<ActionResult<{ created: number; skipped: { email: string; reason: string }[] }>> {
  try {
    const session = await requireRole('hr')
    const supabase = await createClient()

    if (!Array.isArray(rows) || rows.length === 0) return fail('No rows to import.')
    if (rows.length > 500) return fail('Import at most 500 employees at a time.')

    const skipped: { email: string; reason: string }[] = []

    const { data: existing } = await supabase.from('employees').select('email, employee_id')
    const taken = new Set((existing ?? []).map((e) => String(e.email).toLowerCase()))
    // Codes are compared case-insensitively, matching the unique index on
    // upper(employee_id) -- otherwise "emp-0007" imports and then collides.
    const codesTaken = new Set(
      (existing ?? []).map((e) => String(e.employee_id ?? '').toUpperCase()).filter(Boolean),
    )

    const valid: EmployeeInput[] = []
    for (const row of rows) {
      const email = (row.email ?? '').trim().toLowerCase()
      const fullName = (row.fullName ?? '').trim()
      const code = (row.employeeId ?? '').trim().toUpperCase()
      const role = (row.role ?? '').trim().toLowerCase() || 'employee'

      if (!EMAIL_RE.test(email)) {
        skipped.push({ email: email || '(blank)', reason: 'Invalid email' })
      } else if (!fullName) {
        skipped.push({ email, reason: 'Missing name' })
      } else if (taken.has(email)) {
        skipped.push({ email, reason: 'Already on the roster' })
      } else if (code && !EMPLOYEE_CODE_RE.test(code)) {
        skipped.push({
          email,
          reason:
            `Employee ID "${code}" cannot be used — up to 32 characters, letters, ` +
            'digits, . _ / or -, and no spaces',
        })
      } else if (code && codesTaken.has(code)) {
        skipped.push({ email, reason: `Employee ID ${code} is already in use` })
      } else if (!['employee', 'hr', 'admin'].includes(role)) {
        skipped.push({ email, reason: `Role "${role}" must be employee, hr or admin` })
      } else if (role !== 'employee' && session.role !== 'admin') {
        // Same rule as inviteMember: handing out HR or admin access is an
        // administrator's decision, and a CSV must not be a way around it.
        skipped.push({ email, reason: `Only an administrator can import the "${role}" role` })
      } else {
        taken.add(email)
        if (code) codesTaken.add(code)
        valid.push({ ...row, email, fullName, employeeId: code, role })
      }
    }

    if (valid.length === 0) {
      return { ok: true, data: { created: 0, skipped } }
    }

    // Codes are allocated up front so the batch stays contiguous. Rows that
    // brought their own code keep it, and the generator steps over anything
    // already claimed -- by the roster or by an earlier row in this same file --
    // so a supplied EMP-0007 cannot collide with a generated one.
    const base = await nextEmployeeCode(supabase)
    let next = Number(base.replace(/\D/g, '')) || 1

    const allocate = (): string => {
      let code = `EMP-${String(next).padStart(4, '0')}`
      while (codesTaken.has(code)) {
        next += 1
        code = `EMP-${String(next).padStart(4, '0')}`
      }
      next += 1
      codesTaken.add(code)
      return code
    }

    const payload = valid.map((row) => ({
      employee_id: row.employeeId || allocate(),
      full_name: row.fullName,
      email: row.email,
      phone: row.phone || null,
      department: row.department || null,
      designation: row.designation || null,
      joining_date: row.joiningDate || null,
      site_id: row.siteId || null,
      shift_id: row.shiftId || null,
      status: 'active',
    }))

    // The Role column is validated above but deliberately NOT stored on the
    // roster row. `employees` has no role field, and adding one would mean a
    // migration this deployment may not have run -- which is exactly what made
    // every import and login-creation fail with
    // "column employees.intended_role does not exist".
    //
    // Nothing is lost: a roster row cannot hold access anyway. Portals live on
    // `profiles`, so the role is assigned once a login exists, from
    // Members & access, where set_member_role enforces it in Postgres.
    const { error, count } = await supabase
      .from('employees')
      .insert(payload, { count: 'exact' })

    if (error) {
      // A duplicate code is the one failure worth naming precisely: the whole
      // batch rolls back, so "already in use" is more useful than the raw text.
      if (/employees_employee_id_key|duplicate key/i.test(error.message)) {
        return fail(
          'One of the Employee IDs in this file is already on the roster. Nothing was imported.',
        )
      }
      return fail(error.message)
    }

    refresh()
    return { ok: true, data: { created: count ?? payload.length, skipped } }
  } catch (err) {
    return toResult(err)
  }
}

/**
 * Email a password-setup link to employees who have no account yet.
 *
 * Needs the service_role key (only the auth admin API can mint a link) and a
 * configured Resend key. Both are checked up front so the failure is a clear
 * sentence instead of a provider stack trace.
 */
export async function sendInvites(
  employeeIds: string[],
): Promise<ActionResult<{ sent: number; failed: { email: string; reason: string }[] }>> {
  try {
    const session = await requireRole('hr')
    const supabase = await createClient()

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return fail('Select at least one employee to invite.')
    }

    const admin = adminClient()
    if (!admin) return fail(SERVICE_KEY_HELP)
    if (!emailConfigured()) return fail(EMAIL_SETUP_HELP)

    const { data: employees, error } = await supabase
      .from('employees')
      .select('id, email, full_name, user_id')
      .in('id', employeeIds)

    if (error) return fail(error.message)
    if (!employees?.length) return fail('Those employees no longer exist.')

    const appUrl = siteUrl()
    const failed: { email: string; reason: string }[] = []
    let sent = 0

    for (const employee of employees) {
      // Already has an account -> a recovery link; otherwise a fresh invite.
      const type = employee.user_id ? 'recovery' : 'invite'

      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: type as 'invite' | 'recovery',
        email: employee.email,
        options: {
          redirectTo: `${appUrl}/auth/callback`,
          ...(type === 'invite'
            ? { data: { full_name: employee.full_name, role: 'employee', password_created: false } }
            : {}),
        },
      })

      if (linkError || !link?.properties?.hashed_token) {
        failed.push({
          email: employee.email,
          reason: /invalid api key/i.test(linkError?.message ?? '')
            ? 'Service role key rejected'
            : (linkError?.message ?? 'Could not generate a link'),
        })
        continue
      }

      const result = await sendInviteEmail({
        to: employee.email,
        name: employee.full_name,
        link: confirmLink(link.properties.hashed_token, type),
        invitedBy: session.name,
      })

      if (result.ok) sent += 1
      else failed.push({ email: employee.email, reason: result.error ?? 'Send failed' })
    }

    refresh()
    return { ok: true, data: { sent, failed } }
  } catch (err) {
    return toResult(err)
  }
}

/** Whether the HR console should offer the "send invite" affordance at all. */
export async function getEmailCapability(): Promise<{
  email: boolean
  serviceKey: boolean
}> {
  return { email: emailConfigured(), serviceKey: adminClient() !== null }
}

export async function updateEmployee(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const id = String(formData.get('id') ?? '')
    if (!id) return fail('Missing employee id.')

    const fullName = String(formData.get('fullName') ?? '').trim()
    if (!fullName) return fail('Name cannot be empty.')

    const { error } = await supabase
      .from('employees')
      .update({
        full_name: fullName,
        phone: String(formData.get('phone') ?? '').trim() || null,
        department: String(formData.get('department') ?? '').trim() || null,
        designation: String(formData.get('designation') ?? '').trim() || null,
        address: String(formData.get('address') ?? '').trim() || null,
        gender: String(formData.get('gender') ?? '') || null,
        status: String(formData.get('status') ?? 'active'),
        site_id: String(formData.get('siteId') ?? '') || null,
        shift_id: String(formData.get('shiftId') ?? '') || null,
      })
      .eq('id', id)

    if (error) return fail(error.message)

    await notifyEmployee(supabase, id, 'Profile updated', 'HR updated your employee details.')

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

/**
 * Grant an employee another face registration.
 *
 * Clears the stored template AND resets the attempt counter — resetting only
 * the template would leave them locked out, since the portal refuses once the
 * allowance is spent.
 */
export async function resetFaceEnrollment(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireRole('hr')
    const supabase = await createClient()
    const id = String(formData.get('id') ?? '')
    if (!id) return fail('Missing employee.')

    const { error } = await supabase
      .from('employees')
      .update({
        face_descriptor: null,
        face_enrolled_at: null,
        face_enroll_attempts: 0,
        face_enroll_granted_at: new Date().toISOString(),
        face_enroll_granted_by: session.userId,
      })
      .eq('id', id)

    if (error) {
      return fail(
        /face_enroll_attempts/i.test(error.message)
          ? 'Run the face-attempt migration first — the console shows it under Diagnostics.'
          : error.message,
      )
    }

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

export async function decideLeave(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireRole('hr')
    const supabase = await createClient()

    const id = String(formData.get('id') ?? '')
    const decision = String(formData.get('decision') ?? '')
    const note = String(formData.get('note') ?? '').trim()

    if (decision !== 'approved' && decision !== 'rejected') {
      return fail('Decision must be approve or reject.')
    }

    const { data: leave, error: fetchError } = await supabase
      .from('leaves')
      .select('id, employee_id, start_date, end_date, status, leave_type, employees(email, full_name)')
      .eq('id', id)
      .maybeSingle<{
        id: string
        employee_id: string
        start_date: string
        end_date: string
        status: string
        leave_type: string
        employees: { email: string; full_name: string } | null
      }>()

    if (fetchError) return fail(fetchError.message)
    if (!leave) return fail('That leave request no longer exists.')

    const { error } = await supabase
      .from('leaves')
      .update({
        status: decision,
        decided_by: session.userId,
        decided_at: new Date().toISOString(),
        decision_note: note || null,
      })
      .eq('id', id)

    if (error) return fail(error.message)

    // An approved request should show up on the attendance sheet, otherwise the
    // day reads as an unexplained absence in every report.
    //
    // A work-from-home request is NOT time off — approving it means the person
    // is working, remotely. So those days are marked present + remote rather
    // than "on leave", and the employee can still check in from home. A row is
    // written with work_mode='remote' but NO manual_override, so a real check-in
    // recomputes the true hours on top of it.
    const wfh = isWfhLeave(leave.leave_type)
    if (decision === 'approved') {
      type DayRow = {
        employee_id: string
        date: string
        status?: 'leave'
        work_mode?: 'remote'
        notes?: string
      }
      const days: DayRow[] = []
      for (
        let d = new Date(`${leave.start_date}T12:00:00`);
        d <= new Date(`${leave.end_date}T12:00:00`);
        d.setDate(d.getDate() + 1)
      ) {
        const date = d.toISOString().slice(0, 10)
        days.push(
          wfh
            ? { employee_id: leave.employee_id, date, work_mode: 'remote', notes: 'Approved work from home' }
            : { employee_id: leave.employee_id, date, status: 'leave' },
        )
      }

      let { error: markError } = await supabase
        .from('attendance')
        .upsert(days, { onConflict: 'employee_id,date' })

      // work_mode arrives with a later migration; fall back so approval still
      // records the days even if the column is absent.
      if (markError && /work_mode/i.test(markError.message)) {
        const stripped = days.map((d) => {
          const row = { ...d } as Record<string, unknown>
          delete row.work_mode
          return row
        })
        ;({ error: markError } = await supabase
          .from('attendance')
          .upsert(stripped, { onConflict: 'employee_id,date' }))
      }

      if (markError) {
        console.warn('[decideLeave] could not mark attendance:', markError.message)
      }
    }

    // In-app notification (best-effort, realtime-delivered).
    await notifyEmployee(
      supabase,
      leave.employee_id,
      decision === 'approved'
        ? wfh
          ? 'Work-from-home approved'
          : 'Leave approved'
        : 'Leave declined',
      `Your ${leave.leave_type} request (${leave.start_date} → ${leave.end_date}) was ${decision}.` +
        (note ? ` Note: ${note}` : ''),
      decision === 'approved' ? 'success' : 'warning',
    )

    // Notify the employee. Email is best-effort: the decision is already
    // committed, so a provider outage must not surface as a failed approval.
    if (leave.employees?.email && emailConfigured()) {
      const mail = await sendLeaveDecisionEmail({
        to: leave.employees.email,
        name: leave.employees.full_name,
        decision,
        leaveType: leave.leave_type,
        startDate: leave.start_date,
        endDate: leave.end_date,
        note: note || null,
        appUrl: siteUrl(),
      })
      if (!mail.ok) console.warn('[decideLeave] notification email failed:', mail.error)
    }

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export async function createAnnouncement(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireRole('hr')
    const supabase = await createClient()

    const title = String(formData.get('title') ?? '').trim()
    const description = String(formData.get('description') ?? '').trim()
    const priority = String(formData.get('priority') ?? 'normal')

    if (!title) return fail('Give the announcement a title.')
    if (!description) return fail('Announcement body cannot be empty.')

    const { error } = await supabase.from('announcements').insert({
      title,
      description,
      priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
      created_by: session.userId,
    })

    if (error) return fail(error.message)

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

export async function deleteAnnouncement(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const { error } = await supabase
      .from('announcements')
      .delete()
      .eq('id', String(formData.get('id') ?? ''))

    if (error) return fail(error.message)

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export async function saveSite(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const id = String(formData.get('id') ?? '')
    const name = String(formData.get('name') ?? '').trim()
    const kind = String(formData.get('kind') ?? 'office')
    const rawLat = String(formData.get('latitude') ?? '')
    const rawLng = String(formData.get('longitude') ?? '')
    const radius = Number(formData.get('radius'))

    if (!name) return fail('The site needs a name.')
    if (!['office', 'remote', 'hybrid'].includes(kind)) {
      return fail('Pick a valid site type.')
    }

    // A remote site has nowhere to fence, so coordinates are optional — but an
    // office without them would silently accept check-ins from anywhere.
    const hasCoords = rawLat !== '' && rawLng !== ''
    const latitude = hasCoords ? Number(rawLat) : null
    const longitude = hasCoords ? Number(rawLng) : null

    if (kind === 'office' && !hasCoords) {
      return fail('An office needs a location. Place it on the map first.')
    }
    if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
      return fail('Latitude must be between -90 and 90.')
    }
    if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
      return fail('Longitude must be between -180 and 180.')
    }
    if (!Number.isFinite(radius) || radius < 25 || radius > 5000) {
      return fail('Radius must be between 25 and 5000 metres.')
    }

    const payload = {
      name,
      kind,
      address: String(formData.get('address') ?? '').trim() || null,
      latitude,
      longitude,
      radius_m: Math.round(radius),
      is_active: formData.get('isActive') !== 'false',
    }

    const { error } = id
      ? await supabase.from('sites').update(payload).eq('id', id)
      : await supabase.from('sites').insert(payload)

    if (error) return fail(error.message)

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

export async function deleteSite(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const { error } = await supabase
      .from('sites')
      .delete()
      .eq('id', String(formData.get('id') ?? ''))

    if (error) return fail(error.message)

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

export async function saveShift(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const id = String(formData.get('id') ?? '')
    const name = String(formData.get('name') ?? '').trim()
    const startTime = String(formData.get('startTime') ?? '')
    const endTime = String(formData.get('endTime') ?? '')
    const fullDay = Number(formData.get('fullDayMinutes'))
    const halfDay = Number(formData.get('halfDayMinutes'))
    const grace = Number(formData.get('graceMinutes'))
    const workMode = String(formData.get('workMode') ?? 'on_site')
    const workDays = formData
      .getAll('workDays')
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)

    if (!name) return fail('The shift needs a name.')
    if (!startTime || !endTime) return fail('Set both a start and an end time.')
    if (!Number.isFinite(fullDay) || fullDay <= 0) return fail('Full-day minutes must be positive.')
    if (!Number.isFinite(halfDay) || halfDay <= 0) return fail('Half-day minutes must be positive.')
    if (halfDay >= fullDay) {
      return fail('Half-day minutes must be less than full-day minutes.')
    }
    if (workDays.length === 0) return fail('Pick at least one working day.')
    if (!['on_site', 'remote', 'hybrid'].includes(workMode)) {
      return fail('Pick a valid work mode.')
    }

    const payload = {
      name,
      start_time: startTime,
      end_time: endTime,
      full_day_minutes: Math.round(fullDay),
      half_day_minutes: Math.round(halfDay),
      grace_minutes: Number.isFinite(grace) ? Math.max(0, Math.round(grace)) : 15,
      work_days: workDays,
      work_mode: workMode,
      is_active: formData.get('isActive') !== 'false',
    }

    const write = (body: Record<string, unknown>) =>
      id
        ? supabase.from('shifts').update(body).eq('id', id)
        : supabase.from('shifts').insert(body)

    let { error } = await write(payload)

    // work_mode arrives with a later migration; if the column is not there yet,
    // save the shift without it rather than blocking the edit entirely.
    if (error && /work_mode/i.test(error.message)) {
      const core = { ...payload } as Record<string, unknown>
      delete core.work_mode
      ;({ error } = await write(core))
    }

    if (error) return fail(error.message)

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

export async function deleteShift(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const { error } = await supabase
      .from('shifts')
      .delete()
      .eq('id', String(formData.get('id') ?? ''))

    if (error) return fail(error.message)

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Attendance overrides
// ---------------------------------------------------------------------------

/** Let HR correct a day that the automatic rules got wrong. */
export async function overrideAttendance(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const employeeId = String(formData.get('employeeId') ?? '')
    const date = String(formData.get('date') ?? '')
    const status = String(formData.get('status') ?? '')
    const note = String(formData.get('note') ?? '').trim()

    const workMode = String(formData.get('workMode') ?? '')
    const allowed = ['present', 'absent', 'half', 'leave', 'off', 'pending']
    if (!employeeId || !date) return fail('Employee and date are both required.')
    if (!allowed.includes(status)) return fail('That is not a valid attendance status.')

    const row: Record<string, unknown> = {
      employee_id: employeeId,
      date,
      status,
      notes: note || null,
      // manual_override stops the auto-status trigger from recomputing this row
      // back to "absent" on the next write.
      manual_override: true,
    }
    // WFH is recorded as a present day worked remotely, not a separate status.
    if (workMode === 'remote') row.work_mode = 'remote'

    let { error } = await supabase
      .from('attendance')
      .upsert(row, { onConflict: 'employee_id,date' })

    if (error && /work_mode/i.test(error.message)) {
      delete row.work_mode
      ;({ error } = await supabase
        .from('attendance')
        .upsert(row, { onConflict: 'employee_id,date' }))
    }

    if (error) return fail(error.message)

    await notifyEmployee(
      supabase,
      employeeId,
      'Attendance updated',
      `HR set your attendance for ${date} to "${status}".`,
    )

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Send a one-off test email so email configuration can be verified from the
 * console rather than by inviting a real employee and hoping.
 */
export async function sendDiagnosticEmail(
  formData: FormData,
): Promise<ActionResult<{ id?: string; sandbox: boolean }>> {
  try {
    const session = await requireRole('hr')
    if (!emailConfigured()) return fail(EMAIL_SETUP_HELP)

    // Default to the signed-in user: with Resend's sandbox sender that is the
    // only address likely to be accepted anyway.
    const to = String(formData.get('to') ?? '').trim() || session.email
    if (!EMAIL_RE.test(to)) return fail('Enter a valid email address.')

    const result = await sendTestEmail(to)
    if (!result.ok) return fail(result.error ?? 'Send failed.')

    return { ok: true, data: { id: result.id, sandbox: usingSandboxSender() } }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Employee removal
// ---------------------------------------------------------------------------

export interface EmployeeImpact {
  attendance: number
  leaves: number
  hasLogin: boolean
  faceEnrolled: boolean
}

/**
 * What removing this employee would destroy.
 *
 * `attendance` and `leaves` are ON DELETE CASCADE from `employees`, so a delete
 * silently takes their whole history with it. The confirmation dialog shows
 * these counts rather than a generic "are you sure".
 */
export async function getEmployeeImpact(
  employeeId: string,
): Promise<ActionResult<EmployeeImpact>> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const [attendanceRes, leavesRes, employeeRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('id', { count: 'exact', head: true })
        .eq('employee_id', employeeId),
      supabase
        .from('leaves')
        .select('id', { count: 'exact', head: true })
        .eq('employee_id', employeeId),
      supabase
        .from('employees')
        .select('user_id, face_descriptor')
        .eq('id', employeeId)
        .maybeSingle<{ user_id: string | null; face_descriptor: unknown }>(),
    ])

    return {
      ok: true,
      data: {
        attendance: attendanceRes.count ?? 0,
        leaves: leavesRes.count ?? 0,
        hasLogin: Boolean(employeeRes.data?.user_id),
        faceEnrolled: Boolean(employeeRes.data?.face_descriptor),
      },
    }
  } catch (err) {
    return toResult(err)
  }
}

/**
 * Result of a delete, so the UI can say what actually happened to the login
 * rather than guessing.
 */
export interface DeleteOutcome {
  name: string
  /** 'deleted' | 'absent' | 'kept' | 'no_privilege' | 'failed' | 'none' */
  login: string
}

/**
 * Ask Postgres to clear the NULL token columns on one auth user, then retry.
 *
 * GoTrue reads confirmation_token and friends into a Go `string`, so a row
 * holding NULL there cannot be scanned and every admin call against it fails
 * with "Scan error on column index 3, name \"confirmation_token\"" — including
 * the delete itself. The repair function is service_role-only and only ever
 * replaces NULL, so running it here is safe and idempotent.
 */
async function deleteAuthUser(userId: string): Promise<string> {
  const admin = adminClient()
  if (!admin) return 'no_privilege'

  const attempt = async () => admin.auth.admin.deleteUser(userId)

  let { error } = await attempt()
  if (!error) return 'deleted'
  if (/not found/i.test(error.message)) return 'absent'

  // Only the unscannable-row fault is worth repairing and retrying.
  if (!/scan error|converting NULL|database error|unexpected_failure/i.test(error.message)) {
    console.error('[deleteAuthUser] failed:', error.message)
    return 'failed'
  }

  const { error: repairError } = await admin.rpc('repair_auth_users', { target: userId })
  if (repairError) {
    console.error('[deleteAuthUser] repair unavailable:', repairError.message)
    return 'failed'
  }

  ;({ error } = await attempt())
  if (!error) return 'deleted'
  if (/not found/i.test(error.message)) return 'absent'

  console.error('[deleteAuthUser] failed after repair:', error.message)
  return 'failed'
}

/**
 * Permanently remove an employee: roster row, attendance, leaves, profile and
 * sign-in. For someone who has simply left, set their status to `inactive` on
 * the edit form instead — that keeps the history intact for reporting.
 *
 * Three gates, deliberately: the typed name (guards against the wrong row), the
 * caller's own password (guards against an unattended session), and
 * `delete_employee_record` in Postgres, which re-checks the role and refuses to
 * let HR remove an HR or admin account. The database check is the one that
 * actually holds — the other two are UI-side and could be bypassed by calling
 * the API directly.
 */
export async function deleteEmployee(
  formData: FormData,
): Promise<ActionResult<DeleteOutcome>> {
  try {
    const session = await requireRole('hr')
    const supabase = await createClient()

    const id = String(formData.get('id') ?? '')
    if (!id) return fail('Missing employee.')

    const { data: employee } = await supabase
      .from('employees')
      .select('full_name, user_id')
      .eq('id', id)
      .maybeSingle<{ full_name: string; user_id: string | null }>()

    if (!employee) return fail('That employee no longer exists.')

    // Typed-name confirmation: this is unrecoverable from the UI.
    const typed = String(formData.get('confirmName') ?? '').trim()
    if (typed.toLowerCase() !== employee.full_name.trim().toLowerCase()) {
      return fail('The name you typed does not match. Nothing was deleted.')
    }

    // Step-up auth. Throws AuthError, which toResult renders cleanly.
    await requirePassword(
      session.userId,
      session.email,
      String(formData.get('password') ?? ''),
    )

    const { data, error } = await supabase.rpc('delete_employee_record', {
      target: id,
      drop_login: true,
    })

    if (error) {
      return fail(
        /delete_employee_record/i.test(error.message)
          ? 'Employee deletion is not set up on this deployment yet. Run the account-deletion migration.'
          : error.message,
      )
    }

    const outcome = (data ?? {}) as { auth_user_state?: string }
    let login = outcome.auth_user_state ?? 'none'

    // The database could not remove the login itself (it lacks DELETE on
    // auth.users on this deployment). Finish the job over the admin API.
    if (login === 'no_privilege' && employee.user_id) {
      login = await deleteAuthUser(employee.user_id)
    }

    if (login === 'failed' || login === 'no_privilege') {
      console.warn(
        `[deleteEmployee] ${employee.full_name} removed, but their sign-in could not be ` +
          'deleted. Remove it from Supabase → Authentication → Users.',
      )
    }

    refresh()
    return { ok: true, data: { name: employee.full_name, login } }
  } catch (err) {
    return toResult(err)
  }
}


/**
 * Edit a day's check-in / check-out times by hand.
 *
 * HR-only, and never exposed to the employee — the times are what payroll pays
 * against, so a correction (forgotten check-out, a device with the wrong clock)
 * has to be an authorised action. Writing check_in/check_out lets the DB
 * trigger recompute worked minutes; `manual_override` is NOT set here, so the
 * status still follows the corrected hours unless it was overridden separately.
 */
export async function editAttendanceTimes(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const employeeId = String(formData.get('employeeId') ?? '')
    const date = String(formData.get('date') ?? '')
    const checkInTime = String(formData.get('checkIn') ?? '').trim()
    const checkOutTime = String(formData.get('checkOut') ?? '').trim()
    // Minutes east of UTC in the browser that submitted the form, so the times
    // land in the zone the person typing them was looking at.
    const tzOffset = Number(formData.get('tzOffsetMinutes') ?? 'NaN')

    if (!employeeId || !date) return fail('Employee and date are both required.')

    /**
     * Compose `HH:MM` on `date` into an absolute instant.
     *
     * `new Date('2026-07-24T09:00:00')` is parsed in the *server's* zone. On
     * Vercel that is UTC, while the HR user typing 09:00 and reading the table
     * is in their own zone -- so every correction landed offset by that
     * difference, and re-saving shifted it again. The browser sends its offset
     * and the maths is done explicitly instead.
     */
    const compose = (time: string): string | null => {
      if (!time) return null
      const m = time.match(/^(\d{2}):(\d{2})$/)
      if (!m) return null

      const [y, mo, d] = date.split('-').map(Number)
      if (!y || !mo || !d) return null

      const asUtc = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]))
      if (Number.isNaN(asUtc)) return null

      // getTimezoneOffset() is minutes to ADD to local to reach UTC.
      const offset = Number.isFinite(tzOffset) ? tzOffset : 0
      return new Date(asUtc + offset * 60_000).toISOString()
    }

    const checkIn = compose(checkInTime)
    const checkOut = compose(checkOutTime)

    if (checkInTime && !checkIn) return fail('Check-in time must be HH:MM.')
    if (checkOutTime && !checkOut) return fail('Check-out time must be HH:MM.')
    if (checkIn && checkOut && new Date(checkOut) <= new Date(checkIn)) {
      return fail('Check-out must be after check-in.')
    }

    const { error } = await supabase.from('attendance').upsert(
      {
        employee_id: employeeId,
        date,
        check_in: checkIn,
        check_out: checkOut,
        // Corrected times describe the whole day, so previously banked minutes
        // must not be added on top. Without this reset the trigger computes
        // accumulated_minutes + the new session -- which is how a 12:54 -> 12:55
        // correction displayed as 10h against a row that had 600 banked.
        accumulated_minutes: 0,
        session_count: 1,
      },
      { onConflict: 'employee_id,date' },
    )

    if (error) return fail(error.message)

    await notifyEmployee(
      supabase,
      employeeId,
      'Attendance times updated',
      `HR adjusted your check-in / check-out times for ${date}.`,
    )

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Own profile (HR / admin)
// ---------------------------------------------------------------------------

/** Let an HR/admin user edit their own name and phone. */
export async function updateOwnProfile(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireRole('hr')
    const supabase = await createClient()

    const fullName = String(formData.get('fullName') ?? '').trim()
    const phone = String(formData.get('phone') ?? '').trim()
    if (!fullName) return fail('Your name cannot be empty.')

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, phone: phone || null })
      .eq('id', session.userId)

    if (error) return fail(error.message)

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Re-check-in approvals
// ---------------------------------------------------------------------------

/** Approve or deny an employee's request to check in again after clocking out. */
export async function decideRecheckin(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const attendanceId = String(formData.get('attendanceId') ?? '')
    const decision = String(formData.get('decision') ?? '')
    if (!attendanceId) return fail('Missing record.')
    if (decision !== 'approved' && decision !== 'denied') {
      return fail('Decision must be approve or deny.')
    }

    const { data: row, error: fetchError } = await supabase
      .from('attendance')
      .select('id, employee_id, date, recheckin_status')
      .eq('id', attendanceId)
      .maybeSingle<{ id: string; employee_id: string; date: string; recheckin_status: string }>()

    if (fetchError) return fail(fetchError.message)
    if (!row) return fail('That record no longer exists.')

    const { error } = await supabase
      .from('attendance')
      .update({ recheckin_status: decision })
      .eq('id', attendanceId)

    if (error) return fail(error.message)

    await notifyEmployee(
      supabase,
      row.employee_id,
      decision === 'approved' ? 'Re-check-in approved' : 'Re-check-in denied',
      decision === 'approved'
        ? `You can check in again for ${row.date}.`
        : `Your re-check-in request for ${row.date} was declined.`,
      decision === 'approved' ? 'success' : 'warning',
    )

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Role management (admin only)
// ---------------------------------------------------------------------------

export interface Member {
  id: string
  full_name: string
  email: string
  role: string
  account_status?: string | null
  last_login_at?: string | null
  login_count?: number | null
  /**
   * False for a roster row that has no login yet. Such a member has no profile,
   * so `id` is their employees.id and every account action (portal, reset,
   * remove) is meaningless until a login exists.
   */
  hasLogin?: boolean
  /** Present only for roster rows: the employees.id to create a login against. */
  employeeRowId?: string
  employeeCode?: string | null
}

/**
 * Everyone in the organisation, whether or not they can sign in.
 *
 * Two sources, because they answer different questions:
 *  - `profiles` — people with an account. These carry a portal and a password.
 *  - `employees` with no `user_id` — imported or hand-added roster rows. A CSV
 *    import creates these and nothing else, so 119 imported staff previously
 *    left this page showing a single administrator and no way to act on them.
 *
 * Roster rows are marked `hasLogin: false` and the UI offers "Create login"
 * instead of the account controls.
 */
export async function listMembers(): Promise<ActionResult<Member[]>> {
  try {
    await requireRole('hr') // admin passes (is_hr superset); RLS returns rows only to admin
    const supabase = await createClient()
    const query = (columns: string) =>
      supabase.from('profiles').select(columns).order('role').order('full_name')

    let accounts: Member[] = []
    const { data, error } = await query(
      'id, full_name, email, role, account_status, last_login_at, login_count',
    )
    if (!error) {
      accounts = (data ?? []) as unknown as Member[]
    } else {
      // Sign-in tracking columns arrive with a later migration. Fall back to the
      // core fields rather than showing the admin an empty list.
      const retry = await query('id, full_name, email, role')
      if (retry.error) return fail(retry.error.message)
      accounts = (retry.data ?? []) as unknown as Member[]
    }

    accounts = accounts.map((m) => ({ ...m, hasLogin: true }))

    // Roster rows without an account. Best-effort: this page is still useful
    // if the employees read fails, so a failure degrades to accounts only.
    const { data: roster, error: rosterError } = await supabase
      .from('employees')
      .select('id, full_name, email, employee_id, user_id, status')
      .is('user_id', null)
      .order('full_name')

    if (rosterError) {
      console.warn('[listMembers] roster lookup failed:', rosterError.message)
      return { ok: true, data: accounts }
    }

    const claimed = new Set(accounts.map((a) => (a.email ?? '').toLowerCase()))

    const pending: Member[] = (roster ?? [])
      .filter((e) => !claimed.has(String(e.email ?? '').toLowerCase()))
      .map((e) => ({
        id: String(e.id),
        employeeRowId: String(e.id),
        employeeCode: (e.employee_id as string) ?? null,
        full_name: (e.full_name as string) ?? '',
        email: (e.email as string) ?? '',
        role: 'employee',
        account_status: (e.status as string) ?? null,
        hasLogin: false,
      }))

    return { ok: true, data: [...accounts, ...pending] }
  } catch (err) {
    return toResult(err)
  }
}

interface ManageTarget {
  id: string
  email: string
  full_name: string
  role: string
}

/**
 * Resolve the member an account action is aimed at, and refuse the ones the
 * caller has no business touching.
 *
 * HR may manage employees. Only an administrator may touch an HR or admin
 * account — otherwise HR could reset an administrator's password and take the
 * account over, which would make every admin-only rule in the app decorative.
 *
 * The lookup is by member id, not by a posted email address: an id is checked
 * against the row it names, whereas an address supplied by the caller is just a
 * claim about who they are targeting.
 */
async function requireManageTarget(
  session: Session,
  memberId: string,
): Promise<ManageTarget> {
  if (!memberId) throw new AuthError('Missing member.')

  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', memberId)
    .maybeSingle<ManageTarget>()

  if (!data) throw new AuthError('That member no longer exists.')
  if (data.role !== 'employee' && session.role !== 'admin') {
    throw new AuthError('Only an administrator can manage an HR or admin account.')
  }
  return data
}

/**
 * Admin-only: send a member a link to choose a new password.
 *
 * Replaces the grant toggle as the primary route. The toggle depends on
 * set_password_reset_permission, which only exists once migration 20260732 has
 * run; this works on any deployment because it uses GoTrue's own recovery link.
 *
 * The admin never sees or sets the member's password — the member follows the
 * link and chooses it themselves, so the password exists only in their head.
 * If email is not configured the link is returned instead, so an administrator
 * can still pass it on rather than being blocked.
 */
export async function sendPasswordReset(
  formData: FormData,
): Promise<ActionResult<{ emailed: boolean; link?: string }>> {
  try {
    const session = await requireRole('hr')

    // Resolved from the member id, never from a posted email address. Trusting
    // the address let an HR user request a recovery link for any account they
    // could name -- including an administrator's -- and a recovery link is a
    // full account takeover.
    const target = await requireManageTarget(session, String(formData.get('memberId') ?? ''))
    const email = target.email.trim().toLowerCase()
    const name = target.full_name || String(formData.get('name') ?? '').trim()
    if (!email) return fail('That member has no email address on file.')

    const admin = adminClient()
    if (!admin) return fail(SERVICE_KEY_HELP)

    // A recovery link, generated server-side. type=recovery keeps any existing
    // password working until the link is actually used.
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${siteUrl()}/auth/callback?next=/set-password` },
    })

    if (error || !data?.properties?.hashed_token) {
      return fail(
        /not found/i.test(error?.message ?? '')
          ? 'No sign-in account exists for that address yet.'
          : (error?.message ?? 'Could not generate a reset link.'),
      )
    }

    const link = confirmLink(data.properties.hashed_token, 'recovery')

    // Reopen their one self-service change. Without this the member follows the
    // link and /set-password bounces them straight back out, because it treats
    // password_created as "already set up".
    await admin
      .from('profiles')
      .update({ password_created: false })
      .eq('email', email)
      .then(undefined, () => {})

    // A recovery link IS the account until it is used, so it only ever goes
    // back to an administrator. For anyone else an unsendable link is a dead
    // end rather than something to hand around.
    const mayHoldLink = session.role === 'admin'

    if (!emailConfigured()) {
      if (!mayHoldLink) {
        return fail(
          'Invite email is not configured, so the link cannot be sent. Ask an administrator to reset this account.',
        )
      }
      // Not an error: hand the link back so the reset can still happen.
      return { ok: true, data: { emailed: false, link } }
    }

    const sent = await sendPasswordResetEmail({
      to: email,
      name,
      link,
      resetBy: session.name,
    })
    if (!sent.ok) {
      return mayHoldLink
        ? { ok: true, data: { emailed: false, link } }
        : fail('The reset email could not be sent. Ask an administrator to reset this account.')
    }

    return { ok: true, data: { emailed: true } }
  } catch (err) {
    return toResult(err)
  }
}

/**
 * Set a member's password directly.
 *
 * The counterpart to the reset link, for when email is not configured or the
 * member cannot receive it — the common case on a deployment still using
 * Resend's sandbox sender, where mail to anyone but the account owner is
 * accepted and silently dropped.
 *
 * It is deliberately the weaker of the two options: the administrator ends up
 * knowing the password, where a reset link leaves it known only to the member.
 * So it asks for the administrator's own password first, records nothing of the
 * new one, and hands the member back their one self-service change so they can
 * immediately make it theirs again.
 */
export async function setMemberPassword(formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireRole('hr')

    const target = await requireManageTarget(session, String(formData.get('memberId') ?? ''))
    const newPassword = String(formData.get('newPassword') ?? '')
    const confirmPassword = String(formData.get('confirmPassword') ?? '')

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return fail(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`)
    }
    if (newPassword !== confirmPassword) return fail('The two passwords do not match.')

    // Step-up auth on the administrator, matching the delete actions: setting
    // someone else's password is an account takeover if the session is not
    // really theirs.
    await requirePassword(
      session.userId,
      session.email,
      String(formData.get('password') ?? ''),
    )

    const admin = adminClient()
    if (!admin) return fail(SERVICE_KEY_HELP)

    const { error } = await admin.auth.admin.updateUserById(target.id, {
      password: newPassword,
    })

    if (error) {
      // GoTrue rejects a password identical to the current one with 422.
      if (/same.*password/i.test(error.message)) {
        return fail('That is already their password. Choose a different one.')
      }
      if (/password/i.test(error.message)) return fail(error.message)
      console.error('[setMemberPassword] failed:', error.message)
      return fail('Could not set the password. Please try again.')
    }

    // Give them their one self-service change back, so a password the
    // administrator knows does not have to stay the password.
    await admin
      .from('profiles')
      .update({ password_created: false })
      .eq('id', target.id)
      .then(undefined, () => {})

    await supabaseNotify(target.id, session.name)

    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

/** Tell a member their password was changed for them. Best-effort. */
async function supabaseNotify(recipientId: string, actorName: string): Promise<void> {
  try {
    const supabase = await createClient()
    await supabase
      .from('notifications')
      .insert({
        recipient_id: recipientId,
        title: 'Your password was changed',
        body: `${actorName} set a new password for your account. You can change it from My Profile.`,
        kind: 'warning',
      })
      .then(undefined, () => {})
  } catch {
    // A notification is a courtesy, never a reason to fail the reset.
  }
}

/**
 * Create an account and grant it a portal — the only route into FinAtt now
 * that public sign-up is gone.
 *
 * New accounts start on the shared default password with password_created
 * false, which is what leaves their one self-service change available. They
 * sign in with it and change it from their profile when ready.
 *
 * An invited employee also gets a roster row, because the employee portal
 * needs one to check in against.
 */
export async function inviteMember(
  formData: FormData,
): Promise<ActionResult<{ emailed: boolean; link?: string }>> {
  try {
    const session = await requireRole('hr')

    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const name = String(formData.get('name') ?? '').trim()
    const role = String(formData.get('role') ?? 'employee')

    if (!EMAIL_RE.test(email)) return fail('Enter a valid email address.')
    if (!name) return fail('Enter their name.')
    if (!['admin', 'hr', 'employee'].includes(role)) return fail('Pick a valid portal.')

    // Handing out HR or admin access is an administrator's decision. HR can
    // still onboard employees, which is the part they actually need.
    if (role !== 'employee' && session.role !== 'admin') {
      return fail('Only an administrator can grant HR or admin access.')
    }

    const admin = adminClient()
    if (!admin) return fail(SERVICE_KEY_HELP)

    // The shared starting password, by deliberate choice: this deployment has
    // no email provider yet, so a link-based invite would leave new staff with
    // no way in at all.
    //
    // Understand the trade-off. Everyone who has been onboarded knows this
    // value, so until an account is claimed, anyone who knows it can sign in as
    // that account and set their own password -- /set-password cannot ask for
    // proof of the current password, because a new invitee legitimately has
    // none. For an employee account in a small trusted team that is tolerable.
    // For an HR or admin account it is an account takeover.
    //
    // Mitigation that does not need email: right after inviting an HR or admin,
    // use "Set password" on the members list to give them something unique and
    // pass it on directly. Once RESEND_API_KEY is set, invites switch to a link
    // automatically (see the email branch below) and this stops mattering.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        role,
        account_status: 'active',
        password_created: false,
      },
    })

    if (createError || !created?.user) {
      return fail(
        /already been registered|already exists/i.test(createError?.message ?? '')
          ? 'An account already exists for that address. Change their portal from the list instead.'
          : (createError?.message ?? 'Could not create the account.'),
      )
    }

    const userId = created.user.id

    // The signup trigger writes the profile from user_metadata; state it
    // explicitly so the role is correct even where that trigger is absent.
    await admin
      .from('profiles')
      .upsert({
        id: userId,
        full_name: name,
        email,
        role,
        account_status: 'active',
        password_created: false,
      })
      .then(undefined, () => {})

    if (role === 'employee') {
      await admin
        .from('employees')
        .insert({ user_id: userId, full_name: name, email, status: 'active' })
        .then(undefined, () => {})
    }

    refresh()

    // No email configured: the invitee signs in with the shared default and
    // changes it from their profile. Nothing to send.
    if (!emailConfigured()) return { ok: true, data: { emailed: false } }

    // Email IS configured, so prefer a link — it lets them choose a password
    // nobody else ever knows, which the shared default cannot. Falls back to
    // emailing the default if the link cannot be minted.
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    })
    const hashed = linkData?.properties?.hashed_token

    const sent = await sendInviteEmail({
      to: email,
      name,
      link: hashed ? confirmLink(hashed, 'recovery') : `${siteUrl()}/login`,
      invitedBy: session.name,
      ...(hashed ? {} : { defaultPassword: DEFAULT_PASSWORD }),
    })
    return { ok: true, data: { emailed: sent.ok } }
  } catch (err) {
    return toResult(err)
  }
}

/**
 * Assign a member's portal. Enforced in Postgres: set_member_role is SECURITY
 * DEFINER, checks is_admin(), and refuses to demote the last admin -- so even
 * if this action were reached by a non-admin, the database rejects it.
 */
export async function setMemberRole(formData: FormData): Promise<ActionResult> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const target = String(formData.get('memberId') ?? '')
    const role = String(formData.get('role') ?? '')
    if (!target) return fail('Missing member.')
    if (!['admin', 'hr', 'employee'].includes(role)) return fail('Pick a valid portal.')

    const { error } = await supabase.rpc('set_member_role', { target, new_role: role })
    if (error) {
      return fail(
        /set_member_role/i.test(error.message)
          ? 'Role management is not set up on this deployment yet. Run the admin-role migrations.'
          : error.message,
      )
    }

    // target is a profile (user) id, so notify the recipient directly rather
    // than via the employee lookup in notifyEmployee.
    await supabase
      .from('notifications')
      .insert({
        recipient_id: target,
        title: 'Your access changed',
        body: `An administrator set your portal to "${role}".`,
        kind: 'info',
      })
      .then(undefined, () => {})
    refresh()
    return { ok: true }
  } catch (err) {
    return toResult(err)
  }
}

// ---------------------------------------------------------------------------
// Account removal (admin only)
// ---------------------------------------------------------------------------

export interface MemberImpact {
  full_name: string
  email: string
  role: string
  is_self: boolean
  has_employee_row: boolean
  attendance: number
  leaves: number
  last_admin: boolean
}

/**
 * What removing a member account would destroy.
 *
 * Admin-gated in Postgres by `member_delete_impact`, so this cannot be used by
 * HR to enumerate what an administrator's account is attached to.
 */
export async function getMemberImpact(
  memberId: string,
): Promise<ActionResult<MemberImpact>> {
  try {
    await requireRole('hr')
    const supabase = await createClient()

    const { data, error } = await supabase.rpc('member_delete_impact', { target: memberId })
    if (error) {
      return fail(
        /member_delete_impact/i.test(error.message)
          ? 'Account deletion is not set up on this deployment yet. Run the account-deletion migration.'
          : error.message,
      )
    }
    return { ok: true, data: data as MemberImpact }
  } catch (err) {
    return toResult(err)
  }
}

/**
 * Permanently remove a member account — profile, roster row, attendance, leaves
 * and sign-in.
 *
 * Administrator-only, and the check that counts is `delete_member_account` in
 * Postgres: it re-verifies is_admin(), refuses to delete the caller's own
 * account, and refuses to remove the last administrator. This action adds the
 * two gates the database cannot see — the typed email address and the caller's
 * own password.
 *
 * This is the route for removing an HR or an admin. The roster's delete handles
 * employees and will not touch an HR or admin account.
 */
export async function deleteMember(
  formData: FormData,
): Promise<ActionResult<DeleteOutcome>> {
  try {
    const session = await requireRole('hr') // DB enforces admin; see above
    const supabase = await createClient()

    const memberId = String(formData.get('memberId') ?? '')
    const expectedEmail = String(formData.get('email') ?? '').trim().toLowerCase()
    if (!memberId || !expectedEmail) return fail('Missing member.')

    // Typed-email confirmation. Names repeat across a roster; addresses do not,
    // which matters when the rows differ by one character.
    const typed = String(formData.get('confirmEmail') ?? '').trim().toLowerCase()
    if (typed !== expectedEmail) {
      return fail('The email you typed does not match. Nothing was deleted.')
    }

    await requirePassword(
      session.userId,
      session.email,
      String(formData.get('password') ?? ''),
    )

    const { data, error } = await supabase.rpc('delete_member_account', { target: memberId })
    if (error) {
      return fail(
        /delete_member_account/i.test(error.message)
          ? 'Account deletion is not set up on this deployment yet. Run the account-deletion migration.'
          : error.message,
      )
    }

    const outcome = (data ?? {}) as { full_name?: string; auth_user_state?: string }
    let login = outcome.auth_user_state ?? 'none'

    if (login === 'no_privilege') {
      login = await deleteAuthUser(memberId)
    }

    if (login === 'failed' || login === 'no_privilege') {
      console.warn(
        `[deleteMember] ${expectedEmail} removed, but their sign-in could not be deleted. ` +
          'Remove it from Supabase → Authentication → Users.',
      )
    }

    refresh()
    revalidatePath('/admin')
    return { ok: true, data: { name: outcome.full_name || expectedEmail, login } }
  } catch (err) {
    return toResult(err)
  }
}
