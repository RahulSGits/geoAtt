'use client'

import { useMemo, useState } from 'react'
import { mergeDepartments } from '@/lib/departments'

const OTHER = '__other__'

/**
 * Department picker: presets plus anything already used in the organisation,
 * with an "Other" option that reveals a free-text field.
 *
 * A bare <select> would make the list a hard constraint and silently drop any
 * department that isn't on it — including ones already in the database. Merging
 * existing values in, and keeping an escape hatch, means the dropdown is a
 * convenience rather than a schema change.
 */
export default function DepartmentSelect({
  id,
  name = 'department',
  defaultValue,
  existing = [],
  required,
}: {
  id?: string
  name?: string
  defaultValue?: string | null
  /** Departments already present on the roster, so current data stays selectable. */
  existing?: (string | null | undefined)[]
  required?: boolean
}) {
  const options = useMemo(() => mergeDepartments(existing), [existing])

  const initial = defaultValue?.trim() ?? ''
  const initialIsKnown =
    initial !== '' && options.some((o) => o.toLowerCase() === initial.toLowerCase())

  const [choice, setChoice] = useState(
    initial === '' ? '' : initialIsKnown ? initial : OTHER,
  )
  const [custom, setCustom] = useState(initialIsKnown ? '' : initial)

  const showCustom = choice === OTHER
  // The single source of truth submitted with the form.
  const submitted = showCustom ? custom : choice

  return (
    <div className="space-y-2">
      <select
        id={id}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        required={required}
        aria-label={showCustom ? 'Department category' : undefined}
        className="field"
      >
        <option value="">Not assigned</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>

      {showCustom && (
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Type the department name"
          aria-label="Custom department name"
          required={required}
          autoFocus
          className="field"
        />
      )}

      {/* The visible controls are React-managed, so mirror the resolved value
          into a plain field for FormData to pick up. */}
      <input type="hidden" name={name} value={submitted} />
    </div>
  )
}
