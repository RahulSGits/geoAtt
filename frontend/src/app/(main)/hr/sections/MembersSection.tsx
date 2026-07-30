'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Lock, Mail, Plus, Shield, ShieldCheck, Trash2, User } from 'lucide-react'
import { useToast } from '@/components/Toast'
import Modal from '@/components/Modal'
import {
  Alert,
  Avatar,
  EmptyState,
  PageHeader,
  Panel,
  SearchInput,
  Spinner,
} from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { MIN_PASSWORD_LENGTH } from '@/lib/types'

/**
 * The onboarding password, fetched rather than imported.
 *
 * This module is `'use client'`, so importing the value would compile the
 * company's starting credential into the browser bundle — which is exactly how
 * it leaked. The action behind this is HR-guarded.
 *
 * Falls back to prose rather than throwing: a toast that cannot name the
 * password is a much smaller problem than an account creation that appears to
 * have failed after it already succeeded.
 */
async function sharedPassword(): Promise<string> {
  const res = await getOnboardingPassword()
  return res.ok ? res.data : 'the configured onboarding password'
}
import {
  createEmployeeLogin,
  createMissingLogins,
  deleteMember,
  getMemberImpact,
  getOnboardingPassword,
  inviteMember,
  listMembers,
  sendPasswordReset,
  setMemberPassword,
  setMemberRole,
  type Member,
  type MemberImpact,
} from '../actions'

const ROLES = [
  { value: 'employee', label: 'Employee', icon: User, color: '#059669' },
  { value: 'hr', label: 'HR', icon: ShieldCheck, color: '#2563eb' },
  { value: 'admin', label: 'Admin', icon: Shield, color: '#7c3aed' },
] as const

/**
 * The people directory: everyone with a geoAtt account.
 *
 * HR sees the same list and can onboard employees and send reset links, but
 * portal assignment stays with administrators — the buttons render read-only.
 *
 * The button UI is a convenience — the actual authority is `set_member_role` in
 * Postgres, which is SECURITY DEFINER, verifies the caller is an admin, and
 * refuses to demote the last admin. So this list cannot escalate anyone even if
 * it were reached by a non-admin.
 */
export default function MembersSection({ isAdmin }: { isAdmin: boolean }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [inviting, setInviting] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [passwordFor, setPasswordFor] = useState<Member | null>(null)
  const [creatingId, setCreatingId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  /** Roster rows still waiting for an account. */
  const pendingCount = (members ?? []).filter((m) => m.hasLogin === false).length

  /**
   * Give every account-less roster row a login in one pass.
   *
   * 100+ accounts is a slow request by nature — each one is a separate call to
   * the auth admin API — so the button reports what happened rather than
   * pretending it was instant, and partial success is normal.
   */
  async function bulkCreateLogins() {
    setBulkBusy(true)
    const res = await createMissingLogins()

    if (res.ok) {
      const { created, skipped, remaining } = res.data
      if (created > 0) {
        toast.success(
          `Created ${created} login${created === 1 ? '' : 's'}. Everyone signs in with ${await sharedPassword()} and changes it from My Profile.`,
        )
      }
      if (skipped.length > 0) {
        toast.error(
          `${skipped.length} skipped — first: ${skipped[0].email} (${skipped[0].reason}). ${remaining} still without a login.`,
        )
      }
      const after = await listMembers()
      if (after.ok) setMembers(after.data)
      router.refresh()
    } else {
      toast.error(res.error)
    }
    setBulkBusy(false)
  }
  const toast = useToast()
  const router = useRouter()

  useEffect(() => {
    listMembers().then((res) => {
      if (res.ok) setMembers(res.data)
      else setError(res.error)
    })
  }, [])

  /**
   * Put a member on a portal, creating their account first if they have none.
   *
   * A portal lives on `profiles`, so a roster row imported from CSV has nowhere
   * to hold one. Rather than disable the control and make the admin go and
   * create 119 logins by hand first, clicking a portal here does both steps:
   * create the login, then assign. `member.id` is the employees row id until
   * the account exists, so the profile id has to be looked up afterwards.
   */
  async function assign(member: Member, role: string) {
    if (role === member.role && member.hasLogin !== false) return
    setSavingId(member.id)

    let memberId = member.id

    if (member.hasLogin === false) {
      if (!member.employeeRowId) {
        toast.error('That row has no employee record to create a login from.')
        setSavingId(null)
        return
      }

      const createFd = new FormData()
      createFd.set('employeeId', member.employeeRowId)
      const created = await createEmployeeLogin(createFd)
      if (!created.ok) {
        toast.error(created.error)
        setSavingId(null)
        return
      }

      // The new profile shares the employee's email; find its id so the role
      // can be assigned against the account rather than the roster row.
      const refreshed = await listMembers()
      if (!refreshed.ok) {
        toast.error(refreshed.error)
        setSavingId(null)
        return
      }
      setMembers(refreshed.data)

      const account = refreshed.data.find(
        (m) => m.hasLogin !== false && m.email.toLowerCase() === member.email.toLowerCase(),
      )
      if (!account) {
        toast.success(
          `Login created for ${member.full_name || member.email}, but the account was not ready in time to set the portal. Try the portal again.`,
        )
        setSavingId(null)
        return
      }
      memberId = account.id

      if (role === 'employee') {
        toast.success(
          `Login created for ${member.full_name || member.email}. They sign in with ${await sharedPassword()}.`,
        )
        setSavingId(null)
        return
      }
    }

    const fd = new FormData()
    fd.set('memberId', memberId)
    fd.set('role', role)
    const res = await setMemberRole(fd)

    if (res.ok) {
      toast.success(
        member.hasLogin === false
          ? `Login created for ${member.full_name || member.email} and set to ${role}. Starting password: ${await sharedPassword()}`
          : `${member.full_name || member.email} is now ${role}.`,
      )
      const after = await listMembers()
      if (after.ok) setMembers(after.data)
      router.refresh()
    } else {
      toast.error(res.error)
    }
    setSavingId(null)
  }

  /**
   * Give a roster row a sign-in account.
   *
   * The same action the Employees directory uses, surfaced here so an admin who
   * has just imported a CSV can onboard from one place instead of hunting each
   * person down in the other tab.
   */
  async function createLogin(member: Member) {
    if (!member.employeeRowId) return
    setCreatingId(member.id)

    const fd = new FormData()
    fd.set('employeeId', member.employeeRowId)
    const res = await createEmployeeLogin(fd)

    if (res.ok) {
      toast.success(
        `Login created for ${member.full_name || member.email}. They sign in with the shared starting password: ${res.data.password}`,
      )
      router.refresh()
      // Re-read so the row flips from "No login yet" to a real account without
      // a full page reload.
      const refreshed = await listMembers()
      if (refreshed.ok) setMembers(refreshed.data)
    } else {
      toast.error(res.error)
    }
    setCreatingId(null)
  }

  async function resetPassword(member: Member) {
    setResetId(member.id)

    const fd = new FormData()
    // The server resolves the address from this id; a posted email would be an
    // unverified claim about who is being reset.
    fd.set('memberId', member.id)
    fd.set('name', member.full_name ?? '')
    const res = await sendPasswordReset(fd)

    if (!res.ok) {
      toast.error(res.error)
    } else if (res.data?.emailed) {
      toast.success(`Reset link sent to ${member.email}.`)
    } else if (res.data?.link) {
      // Email is off or the send failed. The link still works, so surface it
      // rather than leaving the admin with nothing.
      await navigator.clipboard?.writeText(res.data.link).catch(() => {})
      toast.success('Email is not configured — reset link copied to your clipboard.')
    }
    setResetId(null)
  }

  const adminCount = members?.filter((m) => m.role === 'admin').length ?? 0

  const needle = query.trim().toLowerCase()
  const shown = (members ?? []).filter((m) => {
    if (roleFilter !== 'all' && m.role !== roleFilter) return false
    if (!needle) return true
    return `${m.full_name ?? ''} ${m.email}`.toLowerCase().includes(needle)
  })

  return (
    <>
      <PageHeader
        title="Members & access"
        subtitle="Everyone in the organisation — accounts, and roster rows with no login yet"
        action={
          <button onClick={() => setInviting(true)} className="btn btn-primary btn-sm">
            <Plus size={15} /> Invite member
          </button>
        }
      />

      {pendingCount > 0 && (
        <Alert tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong>
                {pendingCount} {pendingCount === 1 ? 'person has' : 'people have'} no sign-in
                account.
              </strong>{' '}
              They cannot log in with any password until one exists — importing a CSV creates
              roster records only.
            </span>
            <button
              onClick={bulkCreateLogins}
              disabled={bulkBusy}
              className="btn btn-primary btn-sm shrink-0"
            >
              {bulkBusy ? <Spinner size={14} /> : <KeyRound size={14} />}
              {bulkBusy ? 'Creating…' : `Create ${pendingCount} logins`}
            </button>
          </div>
        </Alert>
      )}

      {members && members.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by name or email"
            label="Search members"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by portal"
            className="field w-auto"
          >
            <option value="all">All portals</option>
            <option value="admin">Admin</option>
            <option value="hr">HR</option>
            <option value="employee">Employee</option>
          </select>
          {(query || roleFilter !== 'all') && (
            <span className="muted text-xs">
              {shown.length} of {members.length}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <Panel bodyClassName="p-0">
        {members === null ? (
          <div className="space-y-2 p-4" aria-busy>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <EmptyState icon={<User size={30} />} title="No members" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Last sign-in</th>
                  {!isAdmin && <th>Role</th>}
                  {isAdmin && <th>Portal</th>}
                  <th>Password</th>
                  {isAdmin && <th className="text-right">Remove</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((member) => {
                  // Guard the last admin in the UI too, matching the DB rule.
                  const lockLastAdmin = member.role === 'admin' && adminCount <= 1
                  // A roster row with no account yet. Every control in this
                  // table acts on a login, so they are all meaningless here —
                  // the row offers "Create login" instead.
                  const noLogin = member.hasLogin === false
                  // Listed in PROTECTED_ACCOUNTS. Every control on the row is
                  // inert; the server refuses regardless, this just stops the
                  // click looking like it might work.
                  const locked = member.isProtected === true
                  return (
                    <tr key={member.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={member.full_name || member.email} size={30} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium">
                                {member.full_name || '—'}
                              </span>
                              {member.employeeCode && (
                                <span className="muted shrink-0 text-[10px] tabular-nums">
                                  {member.employeeCode}
                                </span>
                              )}
                              {locked && (
                                <span
                                  title="Locked: cannot be demoted, reset or deleted"
                                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                  style={{
                                    background:
                                      'color-mix(in srgb, var(--primary) 14%, transparent)',
                                    color: 'var(--primary)',
                                  }}
                                >
                                  <Lock size={9} /> Locked
                                </span>
                              )}
                            </div>
                            <div className="muted truncate text-xs">{member.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {noLogin ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                            style={{
                              background: 'color-mix(in srgb, var(--warning) 16%, transparent)',
                              color: 'var(--warning)',
                            }}
                          >
                            No login yet
                          </span>
                        ) : member.last_login_at ? (
                          <span className="text-xs">
                            {formatDateTime(member.last_login_at)}
                          </span>
                        ) : (
                          <span className="muted text-xs">Never signed in</span>
                        )}
                      </td>
                      {!isAdmin && (
                        <td>
                          <span className="text-xs capitalize">{member.role}</span>
                        </td>
                      )}
                      {isAdmin && (
                        <td>
                          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
                            {ROLES.map((r) => {
                              const active = member.role === r.value
                              const Icon = r.icon
                              const disabled =
                                !isAdmin ||
                                locked ||
                                savingId === member.id ||
                                (lockLastAdmin && r.value !== 'admin')
                              return (
                                <button
                                  key={r.value}
                                  onClick={() => assign(member, r.value)}
                                  disabled={disabled}
                                  title={
                                    locked
                                      ? 'This account is locked — its portal cannot be changed'
                                      : !isAdmin
                                        ? 'Only an administrator can change portals'
                                        : lockLastAdmin && r.value !== 'admin'
                                          ? 'Promote someone else to admin first'
                                          : noLogin
                                            ? `Create their login and set ${r.label}`
                                            : `Set ${r.label}`
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
                                  style={
                                    active
                                      ? { background: r.color, color: '#fff' }
                                      : { color: 'var(--text-muted)' }
                                  }
                                >
                                  {savingId === member.id && active ? (
                                    <Spinner size={12} />
                                  ) : (
                                    <Icon size={12} />
                                  )}
                                  {r.label}
                                </button>
                              )
                            })}
                          </div>
                        </td>
                      )}
                      <td>
                        {noLogin ? (
                          <button
                            onClick={() => createLogin(member)}
                            disabled={creatingId === member.id}
                            title={`Create a sign-in account for ${member.email}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
                            style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                          >
                            {creatingId === member.id ? (
                              <Spinner size={12} />
                            ) : (
                              <KeyRound size={12} />
                            )}
                            Create login
                          </button>
                        ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            onClick={() => resetPassword(member)}
                            disabled={resetId === member.id || locked}
                            title={
                              locked
                                ? 'This account is locked — only its owner can change its password'
                                : `Email ${member.email} a link to choose a new password`
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                          >
                            {resetId === member.id ? (
                              <Spinner size={12} />
                            ) : (
                              <Mail size={12} />
                            )}
                            Send reset link
                          </button>
                          <button
                            onClick={() => setPasswordFor(member)}
                            disabled={locked}
                            title={
                              locked
                                ? 'This account is locked — only its owner can change its password'
                                : `Set a new password for ${member.email} yourself`
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                          >
                            <KeyRound size={12} />
                            Set password
                          </button>
                        </div>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="text-right">
                          <button
                            onClick={() => setRemoving(member)}
                            disabled={lockLastAdmin || noLogin || locked}
                            aria-label={`Delete ${member.full_name || member.email}`}
                            title={
                              locked
                                ? 'This account is locked and cannot be deleted'
                                : noLogin
                                  ? 'No account to remove — delete them from the Employees directory instead'
                                  : lockLastAdmin
                                    ? 'The last administrator cannot be removed'
                                    : 'Delete this account permanently'
                            }
                            className="icon-btn icon-btn-danger disabled:opacity-40"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite a member"
        size="md"
      >
        <InviteForm
          isAdmin={isAdmin}
          onDone={(created) => {
            setInviting(false)
            if (created) setMembers(null)
            listMembers().then((res) => res.ok && setMembers(res.data))
          }}
        />
      </Modal>

      <Modal
        open={passwordFor !== null}
        onClose={() => setPasswordFor(null)}
        title="Set a new password"
        description={
          passwordFor ? `${passwordFor.full_name || '—'} · ${passwordFor.email}` : ''
        }
        size="sm"
      >
        {passwordFor && (
          <SetPasswordForm
            member={passwordFor}
            onCancel={() => setPasswordFor(null)}
            onDone={() => setPasswordFor(null)}
          />
        )}
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Delete this account?"
        description={removing ? `${removing.full_name || '—'} · ${removing.email}` : ''}
      >
        {removing && (
          <DeleteMemberForm
            member={removing}
            onCancel={() => setRemoving(null)}
            onDone={(id) => {
              setRemoving(null)
              setMembers((prev) => (prev ? prev.filter((m) => m.id !== id) : prev))
              router.refresh()
            }}
          />
        )}
      </Modal>

      <p className="muted mt-3 text-xs">
        {isAdmin &&
          'The last administrator cannot be demoted or removed — promote someone else to admin first. '}
        A reset link lets the member choose their own password, so nobody else ever
        knows it. Their current password keeps working until the link is used.
      </p>
    </>
  )
}

/**
 * Set a member's password directly, for when the reset link cannot reach them.
 *
 * Asks for the administrator's own password as well, matching the delete
 * dialogs — anything that can take over another account is worth proving you
 * are really the person sitting there.
 */
function SetPasswordForm({
  member,
  onCancel,
  onDone,
}: {
  member: Member
  onCancel: () => void
  onDone: () => void
}) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canSave =
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === confirmPassword &&
    password.length > 0

  async function handleSave() {
    setBusy(true)
    setError(null)

    const fd = new FormData()
    fd.set('memberId', member.id)
    fd.set('newPassword', newPassword)
    fd.set('confirmPassword', confirmPassword)
    fd.set('password', password)
    const res = await setMemberPassword(fd)

    if (res.ok) {
      toast.success(
        `Password updated for ${member.full_name || member.email}. Share it with them directly — they can change it from My Profile.`,
      )
      onDone()
    } else {
      setError(res.error)
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <Alert tone="warning">
        You will know this password, so it is weaker than a reset link. Send a reset link
        instead where you can — it leaves the password known only to them.
      </Alert>

      <div>
        <label className="label" htmlFor="new-password">
          New password for {member.full_name || member.email}
        </label>
        <input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          className="field"
        />
        <p className="muted mt-1 text-xs">At least {MIN_PASSWORD_LENGTH} characters.</p>
      </div>

      <div>
        <label className="label" htmlFor="new-password-confirm">
          Confirm new password
        </label>
        <input
          id="new-password-confirm"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="actor-password">
          Enter <strong>your own</strong> password to authorise
        </label>
        <input
          id="actor-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="field"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave && !busy) handleSave()
          }}
        />
        <p className="muted mt-1 text-xs">
          <Lock size={11} className="inline align-[-1px]" /> Five wrong tries locks this out
          for 15 minutes.
        </p>
      </div>

      {tooShort && (
        <Alert tone="warning">
          That password is too short — use at least {MIN_PASSWORD_LENGTH} characters.
        </Alert>
      )}
      {mismatch && <Alert tone="warning">The two new passwords do not match.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-ghost">
          Cancel
        </button>
        <button onClick={handleSave} disabled={busy || !canSave} className="btn btn-primary">
          {busy && <Spinner size={16} />} <KeyRound size={15} /> Set password
        </button>
      </div>
    </div>
  )
}

/**
 * Confirmation for removing an account outright.
 *
 * Two things must be supplied: the member's own email address, typed out, and
 * the administrator's own password. The first guards against deleting the row
 * next to the intended one; the second against an unattended session. Both are
 * re-checked server-side, and Postgres independently refuses to remove the last
 * admin or the caller themselves.
 */
function DeleteMemberForm({
  member,
  onCancel,
  onDone,
}: {
  member: Member
  onCancel: () => void
  onDone: (id: string) => void
}) {
  const [impact, setImpact] = useState<MemberImpact | null>(null)
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  useEffect(() => {
    let live = true
    getMemberImpact(member.id).then((res) => {
      if (!live) return
      if (res.ok) setImpact(res.data)
      else setError(`Could not read linked records: ${res.error}`)
    })
    return () => {
      live = false
    }
  }, [member.id])

  async function handleDelete() {
    setBusy(true)
    setError(null)

    const fd = new FormData()
    fd.set('memberId', member.id)
    fd.set('email', member.email)
    fd.set('confirmEmail', typed)
    fd.set('password', password)
    const res = await deleteMember(fd)

    if (res.ok) {
      const loginGone = res.data.login === 'deleted' || res.data.login === 'absent'
      if (res.data.login === 'none' || loginGone) {
        toast.success(`${res.data.name} was removed.`)
      } else {
        toast.error(
          `${res.data.name} was removed, but their sign-in could not be deleted. ` +
            'Remove it in Supabase → Authentication → Users.',
        )
      }
      onDone(member.id)
    } else {
      setError(res.error)
      setPassword('')
      setBusy(false)
    }
  }

  const emailMatches = typed.trim().toLowerCase() === member.email.trim().toLowerCase()
  const blocked = impact?.last_admin || impact?.is_self
  const canDelete = emailMatches && password.length > 0 && !blocked

  return (
    <div className="space-y-3">
      <Alert tone="error">
        This cannot be undone. The account, its portal access and everything linked to it
        are removed, and they lose access to geoAtt immediately.
      </Alert>

      {impact === null && !error ? (
        <div className="skeleton h-16 w-full rounded-lg" />
      ) : impact === null ? (
        <Alert tone="warning">
          Linked-record counts are unavailable, so this delete cannot show what it will
          remove.
        </Alert>
      ) : (
        <ul className="space-y-1.5 rounded-lg bg-[var(--surface-2)] p-3 text-sm">
          <li className="flex justify-between">
            <span className="muted">Portal</span>
            <span className="font-semibold capitalize">{impact.role}</span>
          </li>
          <li className="flex justify-between">
            <span className="muted">Employee record</span>
            <span className="font-semibold">
              {impact.has_employee_row ? 'Yes — removed too' : 'None'}
            </span>
          </li>
          <li className="flex justify-between">
            <span className="muted">Attendance records</span>
            <span className="font-semibold tabular-nums">{impact.attendance}</span>
          </li>
          <li className="flex justify-between">
            <span className="muted">Leave requests</span>
            <span className="font-semibold tabular-nums">{impact.leaves}</span>
          </li>
        </ul>
      )}

      {impact?.is_self && (
        <Alert tone="warning">
          This is your own account. You cannot delete the account you are signed in with.
        </Alert>
      )}

      {impact?.last_admin && (
        <Alert tone="warning">
          This is the last administrator. Promote someone else to admin first, or geoAtt
          would be left with nobody who can manage access.
        </Alert>
      )}

      <div>
        <label className="label" htmlFor="confirm-email">
          Type <strong>{member.email}</strong> to confirm
        </label>
        <input
          id="confirm-email"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          // Not the address itself: as a placeholder it makes an empty field
          // look filled, so the disabled Delete button looks broken.
          placeholder="Type their email address"
          autoComplete="off"
          disabled={blocked}
          autoFocus
          className="field"
        />
        {typed.trim() !== '' && !emailMatches && (
          <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
            That does not match “{member.email}” yet.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="confirm-admin-password">
          Enter <strong>your own</strong> password to authorise
        </label>
        <input
          id="confirm-admin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your geoAtt password"
          autoComplete="current-password"
          disabled={blocked}
          className="field"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canDelete && !busy) handleDelete()
          }}
        />
        <p className="muted mt-1 text-xs">
          <Lock size={11} className="inline align-[-1px]" /> Proves it is you, not someone
          who found your screen unlocked. Five wrong tries locks this out for 15 minutes.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-ghost">
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={busy || !canDelete}
          className="btn btn-danger"
        >
          {busy && <Spinner size={16} />} Delete permanently
        </button>
      </div>
    </div>
  )
}

/**
 * Invite form. No password field by design: the account is created without one
 * and the invitee chooses their own from the emailed link, so it is never seen
 * by the administrator issuing the invite.
 */
function InviteForm({
  isAdmin,
  onDone,
}: {
  isAdmin: boolean
  onDone: (created: boolean) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await inviteMember(new FormData(e.currentTarget))

    if (!res.ok) {
      setError(res.error)
      setSaving(false)
      return
    }
    if (res.data?.emailed) {
      toast.success('Invite sent. They will get a link to set their password.')
    } else if (res.data?.link) {
      await navigator.clipboard?.writeText(res.data.link).catch(() => {})
      toast.success('Account created — invite link copied to your clipboard.')
    } else {
      toast.success('Account created.')
    }
    setSaving(false)
    onDone(true)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="inv-name">
          Full name
        </label>
        <input id="inv-name" name="name" required className="field" placeholder="Asha Menon" />
      </div>

      <div>
        <label className="label" htmlFor="inv-email">
          Work email
        </label>
        <input
          id="inv-email"
          name="email"
          type="email"
          required
          className="field"
          placeholder="asha@company.com"
        />
      </div>

      <div>
        <label className="label" htmlFor="inv-role">
          Portal
        </label>
        <select id="inv-role" name="role" defaultValue="employee" className="field">
          <option value="employee">Employee — check in, leave, own attendance</option>
          {isAdmin && <option value="hr">HR — manage people, attendance and leave</option>}
          {isAdmin && <option value="admin">Admin — everything, including access</option>}
        </select>
        <p className="muted mt-1 text-xs">
          {isAdmin
            ? 'You can change this later from the list.'
            : 'Only an administrator can grant HR or admin access.'}
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <button type="submit" disabled={saving} className="btn btn-primary w-full">
        {saving ? <Spinner size={16} /> : <Mail size={16} />} Send invite
      </button>
    </form>
  )
}
