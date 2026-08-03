# geoAtt — Production Readiness

Written against the code and the live database, not from memory. Where
something is unverified it says so.

---

## 1. Face verification

Mobile check-in now refuses a face that does not match the enrolled template —
the same rule the web enforces, against the same templates.

**How it works.** The enrolled vectors come from `@vladmandic/face-api`'s
`faceRecognitionNet`, and a descriptor is only comparable to others from that
same model. So the app runs that exact JavaScript in a 0x0 offscreen WebView
(`components/FaceMatcher.tsx`), loading `/models` from the deployed site. It is
a compute surface, not a wrapper: nothing renders, nothing navigates, every
pixel the user sees is native. The alternative was re-enrolling 600 employees
against a different on-device model, which would have thrown away every
existing template.

**The verdict is server-side.** The web gets its guarantee by re-comparing
inside a server action. The app has no server action, so migration 0016 adds
`verify_my_face()`: the phone sends a descriptor, Postgres returns
`matched / distance / enrolled`, and the `face_match_score` written to
`attendance` is the RPC's number. A modified client cannot assert its own
match. The function reads only the caller's own template via
`current_employee_id()`, so it is not an oracle for testing a face against the
roster.

Both platforms now write a distance, so this audit no longer separates web from
mobile — it separates verified from unverified:

```sql
select date, employee_id, face_match_score
from attendance
where date >= current_date - 30 and face_match_score is null;
```

**Requires `EXPO_PUBLIC_SITE_URL`** in `mobile-rn/.env`, pointing at an HTTPS
deployment that serves `/models`. Unset, the matcher falls back to
`https://geo-att.vercel.app`.

---

## 2. Ready

| | State |
| --- | --- |
| Web build | `next build` passes — 8 static, 6 dynamic routes |
| Web lint / types | 0 errors, 0 warnings |
| Mobile types | 0 errors |
| Face verification | web and mobile, one model, server-side verdict |
| Mobile web export | builds |
| Schema | 16 migrations applied to the live project |
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
- **The camera half of face check-in.** `verify_my_face` is verified end to end
  through a real signed-in employee session: a matching descriptor returns
  `matched` at distance 0, small jitter still matches at 0.1, a different face
  is refused at 2.26, the older flat-descriptor shape still compares, and an
  employee with no template gets `enrolled: false` rather than a false refusal.
  What has **not** run is the phone half — camera -> WebView -> descriptor —
  which needs a real device and an HTTPS deployment serving `/models`. The
  verdict logic is proven; the thing that feeds it is not.
- **Email delivery** — `RESEND_API_KEY` is unset, so invites fall back to the
  shared password.
- **Load at 600 employees.** The HR dashboard still runs `select('*')` on
  `employees` with no pagination, which now pulls `face_descriptor` again after
  migration 0014 restored it. See docs/01-analysis.md §2.2 — the fix is naming
  columns in `hr/page.tsx`, not another migration.
