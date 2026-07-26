'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileDown, FileUp, Table2, Upload, X } from 'lucide-react'
import { Alert, Spinner } from './ui'

export interface ParsedEmployee {
  email: string
  fullName: string
  employeeId?: string
  role?: string
  phone?: string
  department?: string
  designation?: string
  joiningDate?: string
}

/**
 * Header aliases so an export from any HR tool has a fair chance of matching.
 *
 * Note "role" maps to the PORTAL (employee / hr / admin), not to the job title.
 * It used to be an alias for `designation`; a file that says Role when it means
 * "Software Engineer" now lands in the unmapped list and is reported, rather
 * than silently becoming a portal value the importer would reject anyway. Job
 * titles still match on designation / title / job title / position.
 */
const COLUMN_ALIASES: Record<keyof ParsedEmployee, string[]> = {
  email: ['email', 'email address', 'e-mail', 'mail', 'work email'],
  fullName: ['name', 'full name', 'fullname', 'employee name', 'full_name'],
  employeeId: ['employee id', 'employee_id', 'employeeid', 'emp id', 'emp_id', 'code', 'employee code', 'staff id'],
  role: ['role', 'portal', 'access', 'access level', 'user role', 'user type'],
  phone: ['phone', 'mobile', 'contact', 'phone number', 'telephone'],
  department: ['department', 'dept', 'team'],
  designation: ['designation', 'title', 'job title', 'position', 'job_title'],
  joiningDate: ['joining date', 'joined', 'start date', 'joining_date', 'doj', 'hire date'],
}

export const TEMPLATE_FILENAME = 'finatt-employee-template.csv'

/**
 * The downloadable starter file.
 *
 * Employee ID may be left blank — the importer allocates the next EMP-000n.
 * Role is the portal, and only an administrator may import anything other than
 * `employee`; HR's rows are rejected with a reason rather than silently
 * downgraded, so nobody assumes an import granted access it did not.
 */
const TEMPLATE =
  'Employee ID,Name,Email,Role,Phone,Department,Designation,Joining Date\n' +
  'EMP-0101,Priya Menon,priya@company.com,employee,+91 98765 43210,Engineering,Software Engineer,2026-01-15\n' +
  ',Arjun Rao,arjun@company.com,employee,+91 91234 56789,Sales,Account Executive,2026-02-01\n' +
  'EMP-0103,Neha Kulkarni,neha@company.com,hr,+91 99887 76655,People,HR Manager,15/03/2026\n'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 500

/**
 * Split one CSV line, honouring quoted fields.
 *
 * A naive `split(',')` corrupts any row with a comma inside quotes — which is
 * most real address and job-title columns.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out.map((f) => f.trim())
}

interface ParseOutcome {
  rows: ParsedEmployee[]
  errors: string[]
  unmapped: string[]
}

function parseCsv(text: string): ParseOutcome {
  // Tolerate CRLF and a UTF-8 BOM from Excel exports.
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')

  if (lines.length < 2) {
    return { rows: [], errors: ['The file needs a header row and at least one employee.'], unmapped: [] }
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase())

  const indexOf = (field: keyof ParsedEmployee) =>
    headers.findIndex((h) => COLUMN_ALIASES[field].includes(h))

  const map = {
    email: indexOf('email'),
    fullName: indexOf('fullName'),
    employeeId: indexOf('employeeId'),
    role: indexOf('role'),
    phone: indexOf('phone'),
    department: indexOf('department'),
    designation: indexOf('designation'),
    joiningDate: indexOf('joiningDate'),
  }

  const errors: string[] = []
  if (map.email === -1) errors.push('No "Email" column found.')
  if (map.fullName === -1) errors.push('No "Name" column found.')
  if (errors.length) return { rows: [], errors, unmapped: headers }

  const body = lines.slice(1)
  if (body.length > MAX_ROWS) {
    errors.push(`File has ${body.length} rows; only the first ${MAX_ROWS} will be imported.`)
  }

  const rows = body.slice(0, MAX_ROWS).map((line) => {
    const cells = splitCsvLine(line)
    const at = (i: number) => (i >= 0 ? (cells[i] ?? '') : '')
    return {
      email: at(map.email).toLowerCase(),
      fullName: at(map.fullName),
      employeeId: at(map.employeeId).toUpperCase(),
      // Normalised here so "HR", "Admin " and "Employee" all reach the server as
      // the values it checks against. The server re-validates regardless.
      role: at(map.role).trim().toLowerCase(),
      phone: at(map.phone),
      department: at(map.department),
      designation: at(map.designation),
      joiningDate: normaliseDate(at(map.joiningDate)),
    }
  })

  const unmapped = headers.filter(
    (h) => !Object.values(COLUMN_ALIASES).some((aliases) => aliases.includes(h)),
  )

  return { rows, errors, unmapped }
}

/** Accept `YYYY-MM-DD`, `DD/MM/YYYY` and `DD-MM-YYYY`; drop anything else. */
function normaliseDate(value: string): string {
  const v = value.trim()
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v

  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return ''
}

export default function CsvImport({
  onImport,
  onCancel,
}: {
  onImport: (
    rows: ParsedEmployee[],
  ) => Promise<{ ok: boolean; error?: string; created?: number; skipped?: { email: string; reason: string }[] }>
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParseOutcome | null>(null)
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    created: number
    skipped: { email: string; reason: string }[]
  } | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setResult(null)

    if (file.size > MAX_BYTES) {
      setError('That file is larger than 2 MB. Split it into smaller batches.')
      return
    }
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Upload a .csv file. Export from Excel or Sheets as "CSV".')
      return
    }

    setFileName(file.name)
    setParsed(parseCsv(await file.text()))
  }

  async function handleImport() {
    if (!parsed?.rows.length) return
    setBusy(true)
    setError(null)

    const res = await onImport(parsed.rows)

    if (res.ok) {
      setResult({ created: res.created ?? 0, skipped: res.skipped ?? [] })
      setParsed(null)
    } else {
      setError(res.error ?? 'Import failed.')
    }
    setBusy(false)
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = TEMPLATE_FILENAME
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ── Result screen ──────────────────────────────────────────────────── */
  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center py-4 text-center">
          <CheckCircle2 size={40} style={{ color: 'var(--success)' }} />
          <p className="mt-3 text-lg font-semibold">
            {result.created} employee{result.created === 1 ? '' : 's'} imported
          </p>
          {result.skipped.length > 0 && (
            <p className="muted mt-1 text-sm">{result.skipped.length} row(s) skipped</p>
          )}
        </div>

        {result.skipped.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Why it was skipped</th>
                </tr>
              </thead>
              <tbody>
                {result.skipped.map((s, i) => (
                  <tr key={i}>
                    <td className="truncate">{s.email}</td>
                    <td className="muted">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Alert tone="info">
          Imported staff can sign in as soon as they register at <strong>/register</strong>{' '}
          with the same email — their record links automatically. Or select them in the
          directory and send an invite email.
        </Alert>

        <button onClick={onCancel} className="btn btn-primary w-full">
          Done
        </button>
      </div>
    )
  }

  /* ── Preview ────────────────────────────────────────────────────────── */
  if (parsed && parsed.rows.length > 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm">
          <Table2 size={15} style={{ color: 'var(--primary)' }} />
          <span className="min-w-0 flex-1 truncate">{fileName}</span>
          <span className="muted shrink-0 text-xs">{parsed.rows.length} rows</span>
          <button
            onClick={() => {
              setParsed(null)
              setFileName('')
            }}
            aria-label="Choose a different file"
            className="icon-btn"
          >
            <X size={15} />
          </button>
        </div>

        {parsed.errors.map((e, i) => (
          <Alert key={i} tone="warning">
            {e}
          </Alert>
        ))}

        {parsed.unmapped.length > 0 && (
          <Alert tone="info">
            Ignored column{parsed.unmapped.length === 1 ? '' : 's'}:{' '}
            {parsed.unmapped.join(', ')}
          </Alert>
        )}

        <div className="table-wrap max-h-64 overflow-y-auto rounded-lg border border-[var(--border)]">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Designation</th>
              </tr>
            </thead>
            <tbody>
              {parsed.rows.slice(0, 50).map((r, i) => (
                <tr key={i}>
                  <td className="font-medium">{r.fullName || <Missing />}</td>
                  <td>{r.email || <Missing />}</td>
                  <td className="muted">{r.department || '—'}</td>
                  <td className="muted">{r.designation || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {parsed.rows.length > 50 && (
          <p className="muted text-center text-xs">
            Showing the first 50 of {parsed.rows.length}.
          </p>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost" disabled={busy}>
            Cancel
          </button>
          <button onClick={handleImport} disabled={busy} className="btn btn-primary">
            {busy ? <Spinner size={16} /> : <Upload size={16} />}
            Import {parsed.rows.length}
          </button>
        </div>
      </div>
    )
  }

  /* ── Drop zone ──────────────────────────────────────────────────────── */
  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files?.[0]
          if (file) handleFile(file)
        }}
        className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors"
        style={{
          borderColor: dragging ? 'var(--primary)' : 'var(--border)',
          background: dragging ? 'var(--primary-soft)' : 'transparent',
        }}
      >
        <FileUp size={32} className="muted mb-3 opacity-50" />
        <p className="text-sm font-medium">Drop a CSV here</p>
        <p className="muted mt-1 text-xs">or choose a file — up to 500 employees</p>

        <button onClick={() => inputRef.current?.click()} className="btn btn-primary btn-sm mt-4">
          <Upload size={15} /> Choose file
        </button>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
            // Reset so picking the same file twice re-fires onChange.
            e.target.value = ''
          }}
        />
      </div>

      {parsed && parsed.errors.length > 0 && (
        <div className="space-y-2">
          {parsed.errors.map((e, i) => (
            <Alert key={i} tone="error">
              {e}
            </Alert>
          ))}
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      <div className="rounded-lg bg-[var(--surface-2)] p-3">
        <p className="text-xs font-medium">Expected columns</p>
        <p className="muted mt-1 text-xs">
          <strong>Name</strong> and <strong>Email</strong> are required. Employee ID, Role,
          Phone, Department, Designation and Joining Date are optional. Common header
          spellings are matched automatically.
        </p>
        <ul className="muted mt-2 space-y-1 text-xs">
          <li>
            <strong>Employee ID</strong> — leave blank to let FinAtt allocate the next
            code (EMP-0001, EMP-0002…). A code already on the roster is skipped.
          </li>
          <li>
            <strong>Role</strong> — the portal: <code>employee</code>, <code>hr</code> or{' '}
            <code>admin</code>. Blank means employee. Only an administrator can import{' '}
            <code>hr</code> or <code>admin</code>; those rows are skipped for HR. It takes
            effect when the login is created, not at import.
          </li>
        </ul>
        <button onClick={downloadTemplate} className="btn btn-ghost btn-sm mt-2">
          <FileDown size={15} /> Download template
        </button>
      </div>
    </div>
  )
}

function Missing() {
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--danger)' }}>
      <AlertTriangle size={12} /> missing
    </span>
  )
}
