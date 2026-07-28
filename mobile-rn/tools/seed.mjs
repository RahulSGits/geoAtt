/**
 * Creates the three demo accounts and the reference rows the app needs to run.
 *
 *   node --env-file=.env tools/seed.mjs
 *
 * Deliberately seeds NO employee or HR roster — one account per role, one site,
 * one shift, and a single employees row so the employee demo has something to
 * check in against. Nothing else.
 *
 * ── RUN THIS BEFORE DEPLOYING firestore.rules ────────────────────────────────
 *
 * Ordering matters and the failure is confusing otherwise. `firestore.rules`
 * only lets a user create their OWN profile with role 'employee' — that rule is
 * what stops anyone signing up and handing themselves admin. So the admin and
 * HR profiles cannot be written through it, by design.
 *
 * The normal bootstrap is therefore:
 *
 *   1. Firestore in test mode (the default for a new database)
 *   2. node --env-file=.env tools/seed.mjs
 *   3. firebase deploy --only firestore:rules
 *
 * Re-running later, after rules are live, will fail on the admin/HR profile
 * writes with permission-denied. That is correct behaviour, not a bug — promote
 * accounts from the Firebase console instead.
 *
 * Idempotent: existing accounts are signed into rather than recreated, and
 * every document write is a merge.
 */

import { initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore'

// ── config ─────────────────────────────────────────────────────────────────
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
}

const missing = Object.entries(config)
  .filter(([, v]) => !v)
  .map(([k]) => k)

if (missing.length) {
  console.error(`Missing Firebase config: ${missing.join(', ')}`)
  console.error('Fill them in mobile-rn/.env, then re-run with --env-file=.env')
  process.exit(1)
}

/**
 * No default password. This repository is public, so a committed fallback
 * would be a working credential for anyone who reads it.
 */
const PASSWORD = process.env.DEMO_PASSWORD
if (!PASSWORD || PASSWORD.length < 8) {
  console.error('Set DEMO_PASSWORD in mobile-rn/.env (8+ characters) before seeding.')
  process.exit(1)
}

const app = initializeApp(config)
const auth = getAuth(app)
const db = getFirestore(app)

const nowIso = () => new Date().toISOString()

const DEMOS = [
  { key: 'admin', email: 'admin@finatt.app', name: 'Demo Admin', role: 'admin' },
  { key: 'hr', email: 'hr@finatt.app', name: 'Demo HR', role: 'hr' },
  { key: 'employee', email: 'employee@finatt.app', name: 'Demo Employee', role: 'employee' },
]

const SITE_ID = 'site-hq'
const SHIFT_ID = 'shift-general'

/** Create the account, or sign into it if seeding has already run. */
async function ensureAccount({ email, name }) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, PASSWORD)
    await updateProfile(cred.user, { displayName: name })
    return { uid: cred.user.uid, created: true }
  } catch (error) {
    if (error?.code !== 'auth/email-already-in-use') throw error
    const cred = await signInWithEmailAndPassword(auth, email, PASSWORD)
    return { uid: cred.user.uid, created: false }
  }
}

async function main() {
  console.log(`Seeding ${config.projectId}\n`)

  // Reference rows first — the employees record points at both.
  await setDoc(
    doc(db, 'sites', SITE_ID),
    {
      id: SITE_ID,
      name: 'Head Office',
      address: null,
      kind: 'office',
      // Null coordinates keep the geofence inert until a real location is set;
      // a made-up lat/lng would silently fence demo users out of check-in.
      latitude: null,
      longitude: null,
      radius_m: 150,
      is_active: true,
      created_at: nowIso(),
    },
    { merge: true },
  )
  console.log('  sites/site-hq')

  await setDoc(
    doc(db, 'shifts', SHIFT_ID),
    {
      id: SHIFT_ID,
      name: 'General',
      start_time: '09:00:00',
      end_time: '18:00:00',
      grace_minutes: 15,
      full_day_minutes: 480,
      half_day_minutes: 240,
      work_days: [1, 2, 3, 4, 5],
      work_mode: 'on_site',
      is_active: true,
      created_at: nowIso(),
    },
    { merge: true },
  )
  console.log('  shifts/shift-general')

  const results = []

  for (const demo of DEMOS) {
    const { uid, created } = await ensureAccount(demo)

    await setDoc(
      doc(db, 'profiles', uid),
      {
        id: uid,
        full_name: demo.name,
        email: demo.email,
        role: demo.role,
        phone: null,
        department: null,
        designation: null,
        profile_image: null,
        account_status: 'active',
        password_created: true,
        password_reset_allowed: false,
        last_login_at: null,
        login_count: 0,
        created_at: nowIso(),
      },
      { merge: true },
    )

    // Only the employee demo gets an employees row. Admin and HR intentionally
    // have none — on the website an admin has no employees record either, which
    // is exactly what makes employee-only actions reject them.
    if (demo.role === 'employee') {
      await setDoc(
        doc(db, 'employees', uid),
        {
          id: uid,
          user_id: uid,
          employee_id: 'EMP-0001',
          full_name: demo.name,
          email: demo.email,
          phone: null,
          department: 'Operations',
          designation: 'Associate',
          joining_date: nowIso().slice(0, 10),
          gender: null,
          address: null,
          status: 'active',
          profile_image: null,
          site_id: SITE_ID,
          shift_id: SHIFT_ID,
          face_descriptor: null,
          face_enrolled_at: null,
          face_enroll_attempts: 0,
          face_enroll_granted_at: null,
          face_enroll_granted_by: null,
          reward_points: 0,
          created_at: nowIso(),
        },
        { merge: true },
      )
    }

    results.push({ ...demo, uid, created })
    console.log(`  profiles/${uid}  ${demo.role.padEnd(8)} ${demo.email} ${created ? '(new)' : '(existing)'}`)
    await signOut(auth)
  }

  console.log('\nDemo accounts')
  for (const r of results) {
    console.log(`  ${r.role.padEnd(8)} ${r.email.padEnd(22)} ${PASSWORD}`)
  }
  console.log('\nNow lock the database down:  firebase deploy --only firestore:rules')
  process.exit(0)
}

main().catch((error) => {
  console.error('\nSeed failed:', error?.code || '', error?.message || error)
  if (error?.code === 'permission-denied') {
    console.error('Firestore rules are already deployed. See the header of this file.')
  }
  if (error?.code === 'auth/operation-not-allowed') {
    console.error('Enable Email/Password in Firebase console → Authentication → Sign-in method.')
  }
  process.exit(1)
})
