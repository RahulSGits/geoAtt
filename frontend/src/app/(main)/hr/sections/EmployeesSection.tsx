'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, Download, KeyRound, Mail, Search, Upload, UserPlus, Users } from 'lucide-react'
import Modal from '@/components/Modal'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import {
  Alert,
  Avatar,
  EmptyState,
  PageHeader,
  Panel,
  Pill,
  Spinner,
} from '@/components/ui'
import { downloadCsv, formatDate, localDateKey, toCsv } from '@/lib/format'
import type { EmployeeWithAssignment, Shift, Site } from '@/lib/types'
import CsvImport, { type ParsedEmployee } from '@/components/CsvImport'
import DepartmentSelect from '@/components/DepartmentSelect'
import EmployeeRowActions, { FaceCell } from './EmployeeRowActions'
import { DESIGNATIONS } from '@/lib/departments'
import { createEmployee, createEmployeeLogin, importEmployees, sendInvites, updateEmployee } from '../actions'

export default function EmployeesSection({
  employees,
  sites,
  shifts,
}: {
  employees: EmployeeWithAssignment[]
  sites: Site[]
  shifts: Shift[]
}) {
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('all')
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState<EmployeeWithAssignment | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inviting, setInviting] = useState(false)
  const [makingLogin, setMakingLogin] = useState<EmployeeWithAssignment | null>(null)
  const [credentials, setCredentials] = useState<{
    name: string
    email: string
    password: string
    needsConfirmation: boolean
  } | null>(null)
  const [creatingLogin, setCreatingLogin] = useState(false)
  const toast = useToast()
  const router = useRouter()

  const departments = useMemo(
    () =>
      Array.from(
        new Set(employees.map((e) => e.department).filter((d): d is string => Boolean(d))),
      ).sort(),
    [employees],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees.filter((e) => {
      if (department !== 'all' && e.department !== department) return false
      if (!q) return true
      return (
        e.full_name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.employee_id.toLowerCase().includes(q) ||
        (e.designation ?? '').toLowerCase().includes(q)
      )
    })
  }, [employees, query, department])

  function exportCsv() {
    const csv = toCsv(
      ['Employee ID', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Site', 'Shift', 'Joined', 'Status', 'Face enrolled'],
      filtered.map((e) => [
        e.employee_id,
        e.full_name,
        e.email,
        e.phone ?? '',
        e.department ?? '',
        e.designation ?? '',
        e.sites?.name ?? '',
        e.shifts?.name ?? '',
        e.joining_date ?? '',
        e.status,
        e.face_descriptor ? 'Yes' : 'No',
      ]),
    )
    downloadCsv(`employees-${localDateKey()}.csv`, csv)
    toast.success(`Exported ${filtered.length} employees.`)
  }

  async function handleImport(rows: ParsedEmployee[]) {
    const res = await importEmployees(rows)
    if (res.ok) {
      router.refresh()
      return { ok: true, created: res.data.created, skipped: res.data.skipped }
    }
    return { ok: false, error: res.error }
  }

  async function handleInvite() {
    setInviting(true)
    const res = await sendInvites([...selected])

    if (res.ok) {
      const { sent, failed } = res.data
      if (sent > 0) toast.success(`Invite email sent to ${sent} employee(s).`)
      if (failed.length > 0) {
        toast.error(`${failed.length} failed: ${failed[0].reason}`)
      }
      setSelected(new Set())
      router.refresh()
    } else {
      toast.error(res.error)
    }
    setInviting(false)
  }

  async function handleCreateLogin() {
    if (!makingLogin) return
    setCreatingLogin(true)

    const fd = new FormData()
    fd.set('employeeId', makingLogin.id)
    const res = await createEmployeeLogin(fd)

    if (res.ok) {
      setCredentials({ name: makingLogin.full_name, ...res.data })
      setMakingLogin(null)
      router.refresh()
    } else {
      toast.error(res.error)
    }
    setCreatingLogin(false)
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={`${employees.length} on the roster`}
        action={
          <div className="flex flex-wrap gap-2">
            {selected.size > 0 && (
              <button onClick={handleInvite} disabled={inviting} className="btn btn-ghost btn-sm">
                {inviting ? <Spinner size={14} /> : <Mail size={15} />}
                Invite {selected.size}
              </button>
            )}
            <button onClick={exportCsv} disabled={filtered.length === 0} className="btn btn-ghost btn-sm">
              <Download size={15} /> Export
            </button>
            <button onClick={() => setImporting(true)} className="btn btn-ghost btn-sm">
              <Upload size={15} /> Import CSV
            </button>
            <button onClick={() => setAdding(true)} className="btn btn-primary btn-sm">
              <UserPlus size={15} /> Add employee
            </button>
          </div>
        }
      />

      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap gap-2 border-b border-[var(--border)] p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={15}
              className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, ID, email or role"
              aria-label="Search employees"
              className="field pl-9"
            />
          </div>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            aria-label="Filter by department"
            className="field w-auto min-w-[150px]"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={30} />}
            title={employees.length === 0 ? 'No employees yet' : 'No matches'}
            description={
              employees.length === 0
                ? 'Invite your first employee to get started.'
                : 'Try a different search term or department.'
            }
            action={
              employees.length === 0 && (
                <button onClick={() => setAdding(true)} className="btn btn-primary btn-sm">
                  <UserPlus size={15} /> Add employee
                </button>
              )
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      checked={filtered.length > 0 && filtered.every((e) => selected.has(e.id))}
                      onChange={(ev) =>
                        setSelected(ev.target.checked ? new Set(filtered.map((e) => e.id)) : new Set())
                      }
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                  </th>
                  <th>Employee</th>
                  <th>ID</th>
                  <th>Department</th>
                  <th>Site / Shift</th>
                  <th>Account</th>
                  <th>Face</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${e.full_name}`}
                        checked={selected.has(e.id)}
                        onChange={() => toggle(e.id)}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={e.full_name} size={32} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{e.full_name}</div>
                          <div className="muted truncate text-xs">{e.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{e.employee_id}</td>
                    <td>
                      <div>{e.department || '—'}</div>
                      <div className="muted text-xs">{e.designation || '—'}</div>
                    </td>
                    <td>
                      <div className="text-xs">{e.sites?.name ?? 'Unassigned'}</div>
                      <div className="muted text-xs">{e.shifts?.name ?? 'No shift'}</div>
                    </td>
                    <td>
                      {e.user_id ? (
                        <Pill tone="var(--success)">Can sign in</Pill>
                      ) : (
                        <Pill tone="var(--text-muted)">No login</Pill>
                      )}
                    </td>
                    <td>
                      <FaceCell employee={e} />
                    </td>
                    <td>
                      <Pill tone={e.status === 'active' ? 'var(--success)' : 'var(--text-muted)'}>
                        {e.status}
                      </Pill>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {!e.user_id && (
                          <button
                            onClick={() => setMakingLogin(e)}
                            aria-label={`Create a login for ${e.full_name}`}
                            title="Create login"
                            className="icon-btn"
                          >
                            <KeyRound size={15} />
                          </button>
                        )}
                        <EmployeeRowActions employee={e} onEdit={() => setEditing(e)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={makingLogin !== null}
        onClose={() => setMakingLogin(null)}
        title={`Create a login for ${makingLogin?.full_name ?? ''}`}
        description={makingLogin?.email}
        size="sm"
      >
        <div className="space-y-3">
          <Alert tone="info">
            A temporary password is generated. {makingLogin?.full_name?.split(' ')[0]} will
            be asked to choose their own the first time they sign in.
          </Alert>
          <div className="flex justify-end gap-2">
            <button onClick={() => setMakingLogin(null)} className="btn btn-ghost">
              Cancel
            </button>
            <button
              onClick={handleCreateLogin}
              disabled={creatingLogin}
              className="btn btn-primary"
            >
              {creatingLogin ? <Spinner size={16} /> : <KeyRound size={16} />}
              Create login
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={credentials !== null}
        onClose={() => setCredentials(null)}
        title="Login created"
        description={`Share these with ${credentials?.name ?? ''} — the password is shown once.`}
        size="sm"
      >
        {credentials && (
          <CredentialsPanel
            credentials={credentials}
            onDone={() => setCredentials(null)}
          />
        )}
      </Modal>

      <Modal
        open={importing}
        onClose={() => setImporting(false)}
        title="Import employees from CSV"
        description="Rows are created immediately. Invite emails are a separate, optional step."
        size="lg"
      >
        <CsvImport onImport={handleImport} onCancel={() => setImporting(false)} />
      </Modal>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add employee"
        description="Creates the record now. Send the invite email afterwards from the directory."
        size="lg"
      >
        <EmployeeForm
          sites={sites}
          departments={departments}
          shifts={shifts}
          onDone={() => setAdding(false)}
          mode="create"
        />
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.full_name ?? ''}`}
        size="lg"
      >
        {editing && (
          <EmployeeForm
            key={editing.id}
            employee={editing}
            sites={sites}
            departments={departments}
            shifts={shifts}
            onDone={() => setEditing(null)}
            mode="edit"
          />
        )}
      </Modal>
    </>
  )
}

function EmployeeForm({
  employee,
  sites,
  shifts,
  departments,
  onDone,
  mode,
}: {
  employee?: EmployeeWithAssignment
  sites: Site[]
  shifts: Shift[]
  /** Departments already on the roster, merged into the preset list. */
  departments: string[]
  onDone: () => void
  mode: 'create' | 'edit'
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const fd = new FormData(e.currentTarget)
    if (employee) fd.set('id', employee.id)

    const res = mode === 'create' ? await createEmployee(fd) : await updateEmployee(fd)

    if (res.ok) {
      toast.success(mode === 'create' ? 'Invite sent.' : 'Employee updated.')
      onDone()
      router.refresh()
    } else {
      setError(res.error)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" name="fullName" required defaultValue={employee?.full_name} />
        {mode === 'create' ? (
          <Field label="Email" name="email" type="email" required />
        ) : (
          <div>
            <span className="label">Email</span>
            <input value={employee?.email ?? ''} disabled className="field" />
          </div>
        )}
        <Field label="Phone" name="phone" type="tel" defaultValue={employee?.phone ?? ''} />
        <div>
          <label className="label" htmlFor="ef-department">
            Department
          </label>
          <DepartmentSelect
            id="ef-department"
            defaultValue={employee?.department}
            existing={departments}
          />
        </div>
        <div>
          <label className="label" htmlFor="ef-designation">
            Designation
          </label>
          <input
            id="ef-designation"
            name="designation"
            list="designation-options"
            defaultValue={employee?.designation ?? ''}
            placeholder="Start typing or pick one"
            className="field"
          />
          {/* Suggestions, not a constraint — any title can still be typed. */}
          <datalist id="designation-options">
            {DESIGNATIONS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
        {mode === 'create' ? (
          <Field label="Joining date" name="joiningDate" type="date" />
        ) : (
          <div>
            <span className="label">Joined</span>
            <input
              value={employee?.joining_date ? formatDate(employee.joining_date) : '—'}
              disabled
              className="field"
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="ef-gender">
            Gender
          </label>
          <select
            id="ef-gender"
            name="gender"
            defaultValue={employee?.gender ?? ''}
            className="field"
          >
            <option value="">Prefer not to say</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {mode === 'edit' && (
          <div>
            <label className="label" htmlFor="ef-status">
              Status
            </label>
            <select
              id="ef-status"
              name="status"
              defaultValue={employee?.status ?? 'active'}
              className="field"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        )}

        <div>
          <label className="label" htmlFor="ef-site">
            Work site
          </label>
          <select
            id="ef-site"
            name="siteId"
            defaultValue={employee?.site_id ?? ''}
            className="field"
          >
            <option value="">Unassigned</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="ef-shift">
            Shift
          </label>
          <select
            id="ef-shift"
            name="shiftId"
            defaultValue={employee?.shift_id ?? ''}
            className="field"
          >
            <option value="">Unassigned</option>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="ef-address">
          Address
        </label>
        <textarea
          id="ef-address"
          name="address"
          rows={2}
          defaultValue={employee?.address ?? ''}
          className="field resize-y"
        />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="btn btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting && <Spinner size={16} />}
          {mode === 'create' ? 'Send invite' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string
}) {
  const id = `ef-${name}`
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {required && <span aria-hidden> *</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="field"
      />
    </div>
  )
}

/** Shows a freshly-created login once, with copy buttons for handover. */
function CredentialsPanel({
  credentials,
  onDone,
}: {
  credentials: { name: string; email: string; password: string; needsConfirmation: boolean }
  onDone: () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className="space-y-3">
      {credentials.needsConfirmation && (
        <Alert tone="warning">
          This deployment requires new accounts to confirm their email address, so{' '}
          {credentials.name.split(' ')[0]} must click the confirmation link that was just
          emailed before this password will work. Your administrator can change that.
        </Alert>
      )}

      <CopyRow label="Email" value={credentials.email} copied={copied === 'email'} onCopy={() => copy(credentials.email, 'email')} />
      <CopyRow label="Temporary password" value={credentials.password} mono copied={copied === 'pw'} onCopy={() => copy(credentials.password, 'pw')} />

      <Alert tone="info">
        They will be sent to the &ldquo;set your password&rdquo; screen on first sign-in,
        so this temporary one stops working straight away.
      </Alert>

      <button onClick={onDone} className="btn btn-primary w-full">
        Done
      </button>
    </div>
  )
}

function CopyRow({
  label,
  value,
  mono,
  copied,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-2)] p-2">
        <code className={`min-w-0 flex-1 truncate text-sm ${mono ? 'font-mono' : ''}`}>
          {value}
        </code>
        <button onClick={onCopy} className="btn btn-ghost btn-sm shrink-0">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
