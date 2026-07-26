/**
 * Default department list offered when adding or editing an employee.
 *
 * A starting point, not a constraint — `DepartmentSelect` merges these with
 * whatever departments already exist in the organisation and keeps an "Other"
 * option, so an unusual structure is never locked out.
 */
export const DEPARTMENTS = [
  'Engineering',
  'Product',
  'Design',
  'Data & Analytics',
  'Quality Assurance',
  'IT & Infrastructure',
  'Security',
  'Sales',
  'Marketing',
  'Customer Support',
  'Customer Success',
  'Human Resources',
  'Finance & Accounts',
  'Legal & Compliance',
  'Operations',
  'Procurement',
  'Logistics',
  'Manufacturing',
  'Research & Development',
  'Training & Development',
  'Administration',
] as const

/** Common job titles, offered as free-text suggestions on the same forms. */
export const DESIGNATIONS = [
  'Intern',
  'Trainee',
  'Associate',
  'Executive',
  'Senior Executive',
  'Software Engineer',
  'Senior Software Engineer',
  'Lead Engineer',
  'Engineering Manager',
  'Product Manager',
  'Designer',
  'Analyst',
  'Consultant',
  'Team Lead',
  'Assistant Manager',
  'Manager',
  'Senior Manager',
  'Head of Department',
  'Director',
  'Vice President',
] as const

/**
 * Merge the presets with values already in use, case-insensitively, so an
 * existing "engineering" doesn't sit next to a preset "Engineering".
 */
export function mergeDepartments(existing: (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>()

  for (const value of [...DEPARTMENTS, ...existing]) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (!seen.has(key)) seen.set(key, trimmed)
  }

  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
