# geoAtt — Production Readiness

Written against the code and the live database, not from memory. Where
something is unverified it says so.

---

## 1. The blocker: mobile check-in does not verify a face

**This is a decision you have to make, not a task I can finish.**

The web refuses a check-in outright when the live descriptor does not match the
enrolled template:

```ts
// frontend/src/app/(main)/employee/actions.ts
if (matchDistance >= MATCH_THRESHOLD) {
  return fail('Your face did not match the enrolled photo…')
}
```

The mobile app performs **no face check at all**. It verifies location and
writes the same `attendance` row. So today the phone is a strictly weaker path
to an identical record — an employee who cannot pass face verification on the
web can simply use the app.

That is a bypass of the control the product is built on, and it exists because
of a real technical constraint: the enrolled templates come from
`@vladmandic/face-api`'s `faceRecognitionNet`, and no React Native library
produces vectors comparable to them. Matching on the phone needs either that
model running in a JS runtime on-device (~6 MB of weights, slow on mid-range
Android) or a server-side match endpoint.

### What is in place now

- The check-in card states plainly that it is location-verified only.
- `attendance.face_match_score` stays **null** for mobile check-ins and holds a
  distance for web ones, so the two are already distinguishable in the data.
  HR can audit with:

```sql
select date, employee_id, face_match_score is not null as face_verified
from attendance where date >= current_date - 30;
```

### Your options, in order of safety

1. **Server-side match endpoint.** Mobile captures a selfie, uploads it, and a
   function running `face-api` returns the distance. Keeps one model and one
   threshold. The right answer, and the most work.
2. **Restrict mobile check-in to remote/hybrid sites**, where a geofence was
   never the control anyway, and require the web at office sites.
3. **Accept it explicitly**, with the banner and the audit query above.
4. **Disable mobile check-in** until (1) ships.

Doing nothing silently is the only option that is actually wrong.

---

## 2. Ready

| | State |
| --- | --- |
| Web build | `next build` passes — 8 static, 6 dynamic routes |
| Web lint / types | 0 errors, 0 warnings |
| Mobile types | 0 errors |
| Mobile web export | builds |
| Schema | 15 migrations applied to the live project |
| Auth | 3 roles verified end to end |
| Sessions | Keychain / Keystore, chunked |
| RLS | every table, admin-only audit log |
| Offline | banner on `isInternetReachable === false` |
| Dark mode | both palettes, three settings |

---

## 3. Before you ship

### Rotate two credentials

Both were pasted in chat, and GitHub blocked one push because the service key
had reached `.env.example`:

- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API keys
- `SUPABASE_ACCESS_TOKEN` (`sbp_…`) — account-level, so revoke it at
  [account/tokens](https://supabase.com/dashboard/account/tokens) once no more
  migrations are pending

Also rotate `ONBOARDING_PASSWORD`. Its old value is in git history, which
scrubbing the working tree did not change.

### Vercel

Add and then **redeploy** — values are read at build time:

- `NEXT_PUBLIC_SITE_URL=https://geo-att.vercel.app` — without it every invite
  and reset email links to `localhost`
- `ONBOARDING_PASSWORD` — creating logins is refused without it

`NEXT_PUBLIC_API_URL` is read by nothing; safe to delete.

### Database

```sql
alter database postgres set app.timezone = 'Asia/Kolkata';
```

The lateness trigger defaults to this, but setting it on the database makes it
explicit and survives a restore. The **old** system computed shift start `at
time zone 'UTC'` — a 5½-hour error in IST, so `is_late` was always false and
every on-site check-in earned punctuality points regardless of arrival.

### Stores

- Bundle ID `com.geoatt.mobile` on both consoles
- Privacy policy URL — **both** stores reject without one
- Data safety (Play) and privacy labels (App Store): declare email and precise
  location
- Location is requested **when-in-use only**. Do not add background location

---

## 4. Not built

- Face verification on mobile (§1)
- Push notifications — the Updates tab reads rows; nothing pushes
- Calendar month-grid on attendance
- Change password, profile picture, re-check-in requests
- HR/admin consoles on mobile — deliberately a signpost to the web

---

## 5. Not verified

Stated so nobody assumes otherwise:

- **No native binary has been built.** No Xcode, Android SDK or JDK on this
  machine. Everything mobile was verified on the React Native Web target, which
  exercises the same components and data layer but not native permissions,
  Keychain storage or haptics.
- **Face check-in end to end** — needs HTTPS and a real camera.
- **Email delivery** — `RESEND_API_KEY` is unset, so invites fall back to the
  shared password.
- **Load at 600 employees.** The HR dashboard still runs `select('*')` on
  `employees` with no pagination, which now pulls `face_descriptor` again after
  migration 0014 restored it. See docs/01-analysis.md §2.2 — the fix is naming
  columns in `hr/page.tsx`, not another migration.
