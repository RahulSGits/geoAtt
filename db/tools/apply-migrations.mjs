/**
 * Applies db/migrations/*.sql to the Supabase project, in filename order.
 *
 *   node --env-file=db/.env db/tools/apply-migrations.mjs
 *   node --env-file=db/.env db/tools/apply-migrations.mjs 0014   # one file
 *
 * Needs SUPABASE_ACCESS_TOKEN (sbp_…) from
 * supabase.com/dashboard/account/tokens.
 *
 * That token is required and cannot be substituted. The service-role key
 * authenticates to PostgREST, which reads and writes *rows* — it has no DDL
 * endpoint, and none of the project's RPCs execute SQL. Verified by trying:
 * /rest/v1/rpc/{exec_sql,query,exec}, /pg/query and /database/query all 404.
 * The Management API is the only route to `alter table`.
 *
 * Each file is sent as one statement batch, so a file either lands whole or
 * fails whole — a half-applied migration is far worse than a failed one.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'migrations')

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const URL_BASE = process.env.SUPABASE_URL

if (!TOKEN || !URL_BASE) {
  console.error('Missing in db/.env: ' + [!URL_BASE && 'SUPABASE_URL', !TOKEN && 'SUPABASE_ACCESS_TOKEN'].filter(Boolean).join(', '))
  console.error('Generate a token at https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}

const ref = URL_BASE.match(/https:\/\/([^.]+)\./)?.[1]
if (!ref) {
  console.error(`Could not read a project ref out of SUPABASE_URL: ${URL_BASE}`)
  process.exit(1)
}

const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`

async function run(sql) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 400)}`)
  return text
}

const filter = process.argv[2]
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => !filter || f.startsWith(filter))
  .sort()

if (!files.length) {
  console.error(filter ? `No migration matches "${filter}"` : 'No migrations found')
  process.exit(1)
}

console.log(`Project ${ref} — applying ${files.length} migration(s)\n`)

let failed = 0
for (const file of files) {
  process.stdout.write(`  ${file.padEnd(34)}`)
  try {
    await run(readFileSync(join(DIR, file), 'utf8'))
    console.log('ok')
  } catch (err) {
    failed++
    console.log('FAILED')
    console.log(`      ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`)
  }
}

console.log(failed ? `\n${failed} migration(s) failed.` : '\nAll migrations applied.')
process.exit(failed ? 1 : 0)
