/**
 * Creates the admin / HR / employee accounts in a fresh Supabase project.
 *
 *   node --env-file=db/.env db/tools/create-accounts.mjs
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY. That is not optional and cannot be worked
 * around: the publishable key can only reach /auth/v1/signup, which (a) leaves
 * the account unconfirmed while mailer_autoconfirm is off, so it cannot sign
 * in, and (b) cannot set a role. Only the admin API can create a confirmed
 * user outright.
 *
 * RUN THE SCHEMA FIRST — db/apply-all.sql. This script checks and refuses
 * otherwise, because an auth user created before public.profiles exists is
 * orphaned: the handle_new_user trigger that would have written its profile
 * does not exist yet, and nothing backfills it later. The result is an account
 * that signs in to a broken session.
 *
 * No dependencies: plain fetch against the Auth Admin API and PostgREST, so it
 * runs from the repo root without an install.
 *
 * Idempotent. An address that already exists is left alone rather than
 * recreated, and profile writes are upserts.
 */

const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = process.env.DEMO_PASSWORD

// Name the variable that is actually missing. "one of these two" sends people
// to re-check a value that was already correct.
const missing = [
  !URL_BASE && 'SUPABASE_URL',
  !SERVICE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean)

if (missing.length) {
  console.error(`Missing in db/.env: ${missing.join(', ')}`)
  if (!SERVICE_KEY) {
    console.error('The service-role key is at Supabase -> Project Settings -> API keys.')
    console.error('It bypasses RLS — keep it out of any client bundle and out of git.')
  }
  process.exit(1)
}

/**
 * No default password. This repository is public, so a committed fallback would
 * be a working credential for every account this script creates.
 */
if (!PASSWORD || PASSWORD.length < 8) {
  console.error('Set DEMO_PASSWORD in db/.env (8+ characters) before running.')
  process.exit(1)
}

const ACCOUNTS = [
  { email: 'admin@financebuddha.com', name: 'Administrator', role: 'admin' },
  { email: 'hr@financebuddha.com', name: 'HR Manager', role: 'hr' },
  { email: 'employee@financebuddha.com', name: 'Demo Employee', role: 'employee' },
]

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

/** Refuse to create orphaned auth users — see the header. */
async function assertSchemaExists() {
  const res = await fetch(`${URL_BASE}/rest/v1/profiles?select=id&limit=1`, { headers })
  if (res.status === 404) {
    console.error('public.profiles does not exist — the schema has not been applied.')
    console.error('Paste db/apply-all.sql into the Supabase SQL editor, then re-run this.')
    process.exit(1)
  }
  if (!res.ok) {
    console.error(`Could not read public.profiles (HTTP ${res.status}): ${await res.text()}`)
    process.exit(1)
  }
}

/** Find an existing auth user by email, or null. */
async function findUser(email) {
  const res = await fetch(
    `${URL_BASE}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers },
  )
  if (!res.ok) return null
  const body = await res.json()
  const users = body.users ?? []
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null
}

async function createUser({ email, name, role }) {
  const res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password: PASSWORD,
      // Confirmed outright. Without this the account exists but cannot sign in
      // until a confirmation email is clicked, and this project has
      // mailer_autoconfirm off.
      email_confirm: true,
      // The schema's handle_new_user trigger reads these to write the profile.
      // They are stated here so the role is right even where that trigger is
      // absent, and the upsert below states it again regardless.
      user_metadata: { full_name: name, role, password_created: false },
    }),
  })
  if (!res.ok) throw new Error(`create ${email}: HTTP ${res.status} ${await res.text()}`)
  return (await res.json()).id
}

/** Upsert the profile row, so the role is correct whether or not a trigger ran. */
async function upsertProfile(id, { email, name, role }) {
  const res = await fetch(`${URL_BASE}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      id,
      email,
      full_name: name,
      role,
      // First sign-in is sent to /set-password to choose their own.
      password_created: false,
      is_active: true,
    }),
  })
  if (!res.ok) throw new Error(`profile ${email}: HTTP ${res.status} ${await res.text()}`)
}

async function main() {
  console.log(`Target: ${URL_BASE}\n`)
  await assertSchemaExists()

  const results = []
  for (const account of ACCOUNTS) {
    const existing = await findUser(account.email)
    const id = existing ? existing.id : await createUser(account)
    await upsertProfile(id, account)
    results.push({ ...account, created: !existing })
    console.log(`  ${account.role.padEnd(8)} ${account.email.padEnd(30)} ${existing ? '(existed)' : '(created)'}`)
  }

  console.log('\nAccounts')
  for (const r of results) console.log(`  ${r.role.padEnd(8)} ${r.email.padEnd(30)} ${PASSWORD}`)
  console.log('\nEveryone starts with password_created = false, so the first sign-in')
  console.log('is redirected to /set-password to choose their own.')
}

main().catch((err) => {
  console.error('\nFailed:', err.message)
  process.exit(1)
})
