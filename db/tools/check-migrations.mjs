/**
 * Static checks over db/migrations, run in filename order.
 *
 *   node db/tools/check-migrations.mjs
 *
 * There is no Postgres on this machine, and a migration that only fails when
 * applied to the real project fails in the worst possible place. These are the
 * errors that are detectable without a server:
 *
 *   1. Unbalanced dollar-quoting — the classic way a function body swallows the
 *      rest of a file and produces a syntax error hundreds of lines later.
 *   2. Forward references — a table, type or function used before the file that
 *      creates it. Files run in order, so this is a hard failure at apply time.
 *   3. Unbalanced parentheses.
 *
 * Exits non-zero on any error so it can gate a commit.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

const errors = []
const warnings = []

// Things Postgres/Supabase provide; never "defined" by our files.
const BUILTIN_TABLES = new Set(['auth.users', 'storage.objects', 'storage.buckets'])
const BUILTIN_FUNCS = new Set([
  'auth.uid', 'auth.role', 'auth.jwt', 'gen_random_uuid', 'now', 'crypt',
  'gen_salt', 'nextval', 'lpad', 'coalesce', 'greatest', 'least', 'lower',
  'upper', 'count', 'avg', 'round', 'unnest', 'extract', 'make_interval',
  'jsonb_build_object', 'current_setting', 'nullif', 'array_length', 'format',
  'daterange', 'exists', 'date_trunc', 'sum', 'max', 'min', 'concat',
])

const defined = { tables: new Set(), types: new Set(), functions: new Set() }

/**
 * Calls that legitimately reference a function defined in a LATER file.
 *
 * PostgreSQL does not resolve plpgsql function bodies at creation time — only
 * when the function first runs. So a body may name something that does not
 * exist yet, provided nothing invokes it in the meantime.
 *
 * Each entry here is a claim that the deferral is safe, and why.
 */
const LAZY_BODY_CALLS = [
  {
    file: '0002_identity.sql',
    fn: 'public.is_admin',
    // profiles_guard_role's body calls is_admin(), which 0011 creates. Safe
    // because 0002 only defines the function; the trigger that fires it is
    // attached in 0011, after is_admin() exists.
    why: 'trigger attached in 0011, after is_admin() is created',
  },
]

/**
 * Strip comments and string literals so scanning does not trip on prose.
 *
 * Block comments must go BEFORE string literals. An apostrophe inside a
 * comment — "the caller's employees row" — otherwise opens a string literal
 * that swallows everything up to the next apostrophe, taking real parentheses
 * with it. That produced a phantom "unbalanced parentheses" error against SQL
 * that was correct.
 */
function scrub(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''")
}

for (const file of files) {
  const raw = readFileSync(join(DIR, file), 'utf8')

  // 1. Dollar quoting. Every $$ (or $tag$) must pair up.
  const tags = raw.match(/\$[a-zA-Z_]*\$/g) ?? []
  const counts = new Map()
  for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  for (const [tag, n] of counts) {
    if (n % 2 !== 0) errors.push(`${file}: unbalanced dollar-quote ${tag} (${n} occurrences)`)
  }

  const sql = scrub(raw)

  // 2. Parentheses.
  let depth = 0
  for (const ch of sql) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth < 0) break
  }
  if (depth !== 0) errors.push(`${file}: unbalanced parentheses (net ${depth})`)

  // 3. Collect what this file defines, BEFORE checking its own references —
  //    a file may legitimately reference something it just created.
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi))
    defined.tables.add(m[1].toLowerCase())
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+([\w.]+)/gi))
    defined.tables.add(m[1].toLowerCase())
  for (const m of sql.matchAll(/create\s+type\s+([\w.]+)/gi))
    defined.types.add(m[1].toLowerCase())
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)/gi))
    defined.functions.add(m[1].toLowerCase())
  for (const m of sql.matchAll(/create\s+sequence\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi))
    defined.tables.add(m[1].toLowerCase())

  // 4. Foreign keys must point at something that already exists.
  for (const m of sql.matchAll(/references\s+([\w.]+)\s*\(/gi)) {
    const t = m[1].toLowerCase()
    if (!defined.tables.has(t) && !BUILTIN_TABLES.has(t)) {
      errors.push(`${file}: references ${t} before it is created`)
    }
  }

  // 5. Enum types must be created in an earlier file (0001).
  for (const m of sql.matchAll(/\bpublic\.(app_role|attendance_status|leave_status|site_kind|work_mode|priority|recheckin_status|employment_status)\b/gi)) {
    const t = `public.${m[1].toLowerCase()}`
    if (!defined.types.has(t)) errors.push(`${file}: uses type ${t} before it is created`)
  }

  // 6. Functions invoked by triggers must be defined by now.
  for (const m of sql.matchAll(/execute\s+function\s+([\w.]+)/gi)) {
    const f = m[1].toLowerCase()
    if (!defined.functions.has(f)) errors.push(`${file}: trigger calls ${f} before it is defined`)
  }

  // 7. public.* function calls, best effort — flags a typo'd helper name.
  for (const m of sql.matchAll(/\bpublic\.(\w+)\s*\(/gi)) {
    const f = `public.${m[1].toLowerCase()}`
    if (defined.functions.has(f) || defined.tables.has(f) || defined.types.has(f)) continue
    if (LAZY_BODY_CALLS.some((a) => a.file === file && a.fn === f)) continue
    warnings.push(`${file}: calls ${f}, not defined in any earlier file`)
  }
}

console.log(`Checked ${files.length} migrations in order:\n  ${files.join('\n  ')}\n`)
console.log(`Defined: ${defined.tables.size} tables/views/sequences, ${defined.types.size} types, ${defined.functions.size} functions`)

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`)
  for (const w of new Set(warnings)) console.log('  ⚠ ' + w)
}

if (errors.length) {
  console.log(`\n${errors.length} error(s):`)
  for (const e of new Set(errors)) console.log('  ✗ ' + e)
  process.exit(1)
}

console.log('\nNo ordering or syntax-balance errors.')
