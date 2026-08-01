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
  { email: 'admin@geoatt.app', name: 'Administrator', role: 'admin' },
  { email: 'hr@geoatt.app', name: 'HR Manager', role: 'hr' },
  { email: 'employee@geoatt.app', name: 'Demo Employee', role: 'employee' },
]

/**
 * Remove every auth user that is not in ACCOUNTS.
 *
 * Off by default. Deleting a login is irreversible and takes its attendance
 * history with it through the cascade on employees.user_id, so it has to be
 * asked for explicitly:
 *
 *   PRUNE_OTHER_ACCOUNTS=1 node --env-file=db/.env db/tools/create-accounts.mjs
 */
const PRUNE = process.env.PRUNE_OTHER_ACCOUNTS === '1'

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
      // The schema's handle_new_user trigger reads these. password_created is
      // true so these credentials work as given: false would make the proxy
      // divert the first sign-in to /set-password to choose a new one, which is
      // right for a real invite and wrong for a stated demo login.
      user_metadata: { full_name: name, role, password_created: true },
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
      // See createUser: true so the listed password signs straight in.
      password_created: true,
      is_active: true,
    }),
  })
  if (!res.ok) throw new Error(`profile ${email}: HTTP ${res.status} ${await res.text()}`)
}

/**
 * Find a row by name, or insert it. Returns its id, or null with the reason
 * logged.
 *
 * Deliberately not PostgREST's `on_conflict=name` upsert: that needs a unique
 * constraint on the bare column, and the schema indexes `lower(name)` for
 * case-insensitive uniqueness instead. The upsert therefore failed — silently,
 * because the first version of this only checked `res.ok` on the employees
 * write, so sites and shifts came out empty and the employee was left with no
 * site and no shift.
 */
async function findOrCreate(table, name, row) {
  const found = await fetch(
    `${URL_BASE}/rest/v1/${table}?select=id&name=eq.${encodeURIComponent(name)}&limit=1`,
    { headers },
  )
  if (found.ok) {
    const rows = await found.json()
    if (rows.length) return rows[0].id
  }

  const res = await fetch(`${URL_BASE}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
  if (!res.ok) {
    console.log(`  ${table.padEnd(10)} FAILED (HTTP ${res.status}) ${(await res.text()).slice(0, 160)}`)
    return null
  }
  return (await res.json())[0]?.id ?? null
}

/**
 * Give the employee account something to actually be.
 *
 * An employees row is what employee-only actions key off — check-in, leave,
 * the whole portal. Admin and HR deliberately get none: on the web app an
 * admin has no employees row either, and that absence is exactly what makes
 * employee-only actions reject them.
 *
 * The site is created with null coordinates on purpose. A made-up lat/lng
 * would put a geofence somewhere real and silently refuse every check-in from
 * anywhere else; null leaves the fence inert until a genuine location is set.
 */
async function scaffoldEmployee(employee) {
  if (!employee) return

  // Hybrid, not office and not remote.
  //
  // `sites_office_has_location` rejects an office row with null coordinates —
  // correctly, since an unfenceable office would accept a check-in from
  // anywhere while appearing enforced. Inventing coordinates would be worse: a
  // real geofence somewhere arbitrary, refusing every genuine check-in.
  //
  // Remote was the first choice but it hides the map in the site editor, since
  // only office and hybrid are location-restricted — so there was no way to
  // set the real location from the UI. Hybrid shows the map, accepts null
  // coordinates, and does not refuse anyone while the location is still blank.
  const siteId = await findOrCreate('sites', 'Head Office', {
    name: 'Head Office',
    kind: 'hybrid',
    is_active: true,
  })

  const shiftId = await findOrCreate('shifts', 'General', {
    name: 'General',
    start_time: '09:00:00',
    end_time: '18:00:00',
    grace_minutes: 15,
    full_day_minutes: 480,
    half_day_minutes: 240,
    work_days: [1, 2, 3, 4, 5],
    work_mode: 'on_site',
    is_active: true,
  })

  // employees.user_id is unique, so on_conflict works here where it did not
  // for the name-keyed tables above.
  const res = await fetch(`${URL_BASE}/rest/v1/employees?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      user_id: employee.id,
      employee_code: 'EMP-0001',
      designation: 'Associate',
      joining_date: new Date().toISOString().slice(0, 10),
      status: 'active',
      site_id: siteId,
      shift_id: shiftId,
    }),
  })

  if (!res.ok) {
    console.log(`  employees  FAILED (HTTP ${res.status}) ${(await res.text()).slice(0, 160)}`)
    return
  }
  console.log(`  employees  EMP-0001 -> ${employee.email}  site=${siteId ? 'ok' : 'none'} shift=${shiftId ? 'ok' : 'none'}`)
}

/** Delete every auth user not in ACCOUNTS. Guarded by PRUNE_OTHER_ACCOUNTS=1. */
async function pruneOthers() {
  const keep = new Set(ACCOUNTS.map((a) => a.email.toLowerCase()))
  const res = await fetch(`${URL_BASE}/auth/v1/admin/users?per_page=200`, { headers })
  if (!res.ok) {
    console.log(`  prune skipped — could not list users (HTTP ${res.status})`)
    return
  }
  const { users = [] } = await res.json()
  const doomed = users.filter((u) => u.email && !keep.has(u.email.toLowerCase()))

  if (!doomed.length) {
    console.log('  prune: no other accounts')
    return
  }
  for (const u of doomed) {
    const del = await fetch(`${URL_BASE}/auth/v1/admin/users/${u.id}`, {
      method: 'DELETE',
      headers,
    })
    console.log(`  deleted ${u.email} ${del.ok ? '' : `(HTTP ${del.status})`}`)
  }
}

async function main() {
  console.log(`Target: ${URL_BASE}\n`)
  await assertSchemaExists()

  const results = []
  for (const account of ACCOUNTS) {
    const existing = await findUser(account.email)
    const id = existing ? existing.id : await createUser(account)
    await upsertProfile(id, account)
    results.push({ ...account, id, created: !existing })
    console.log(`  ${account.role.padEnd(8)} ${account.email.padEnd(30)} ${existing ? '(existed)' : '(created)'}`)
  }

  // The employee portal needs an employees row, and check-in needs a site and
  // a shift to reference. Without them the account signs in to an empty portal.
  await scaffoldEmployee(results.find((r) => r.role === 'employee'))

  if (PRUNE) await pruneOthers()

  console.log('\nAccounts')
  for (const r of results) console.log(`  ${r.role.padEnd(8)} ${r.email.padEnd(30)} ${PASSWORD}`)
  console.log('\nThese sign in directly — password_created is true, so the proxy does')
  console.log('not divert the first login to /set-password.')
}

main().catch((err) => {
  console.error('\nFailed:', err.message)
  process.exit(1)
})
