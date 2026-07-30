# geoAtt — Deployment

## Vercel environment variables

These are the **only** variables `frontend/` reads, extracted from the source
rather than from memory:

```bash
grep -rhoE "process\.env\.[A-Z0-9_]+" frontend/src frontend/next.config.ts | sed 's/process\.env\.//' | sort -u
```

| Variable | Required? | Without it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Nothing works |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Yes** | Nothing works |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Invites and login creation fail |
| `NEXT_PUBLIC_SITE_URL` | **Yes** | **Every emailed invite and reset link points at `http://localhost:3000`** |
| `ONBOARDING_PASSWORD` | **Yes** | Creating logins is refused outright |
| `PROTECTED_ACCOUNTS` | Recommended | No account is protected from demotion or deletion |
| `RESEND_API_KEY` | Optional | Invites fall back to the shared password instead of a link |
| `EMAIL_FROM` | With Resend | Must be quoted — the angle brackets are shell redirects otherwise |
| `GEMINI_API_KEY` | Optional | The AI assistant is disabled |
| `GEMINI_MODEL` | Optional | A fallback chain self-heals |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional | The site editor falls back to Leaflet/OpenStreetMap |

### Names must match character for character

An environment variable is only read by exact name. A misspelling does not
error — `process.env.NEXT_PUBLIC_SUPABASE_URL` simply evaluates to `undefined`,
and the app fails as if the variable were never set. `SUPABASE` and `SUPBASE`
look identical at a glance in a long list.

If a deployed build behaves as though a variable is missing while the dashboard
clearly shows it, compare the name against the table above one character at a
time before looking anywhere else.

### `NEXT_PUBLIC_` is not a suggestion

Next.js inlines **only** `NEXT_PUBLIC_*` variables into the browser bundle.
Everything else is server-only. That split is a security boundary, not a naming
convention:

- `SUPABASE_SERVICE_ROLE_KEY` must **never** gain the prefix. It bypasses all
  Row Level Security, and prefixing it would compile it into the JavaScript
  served to every visitor.
- Equally, a variable the browser needs will be `undefined` without the prefix.

### Adding one

Vercel → Project → Settings → Environment Variables → **Add New**. Set the name,
paste the value, tick **Production** and **Preview**, save.

Then **redeploy**. Environment variables are read at build time, so an existing
deployment does not pick up a new value — Deployments → ⋯ → Redeploy.

### Unused variables

`NEXT_PUBLIC_API_URL` appears in the dashboard but no code reads it. It is a
leftover from the abandoned NestJS/FastAPI backends and can be deleted; the
frontend talks to Supabase directly and uses `NEXT_PUBLIC_SITE_URL` for
absolute links.

---

## The mobile app does not use Vercel variables

`mobile-rn/` is a separate build. It reads `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_KEY` from `mobile-rn/.env` locally, or from EAS secrets
for a store build:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://…
```

Same rule as Next: only `EXPO_PUBLIC_*` reaches the client, and the
service-role key must never be among them — anything in a mobile bundle is
readable by anyone who downloads the app.

---

## First-run order

The steps are not interchangeable. Doing them out of order produces confusing
failures rather than clean errors.

### 1. Apply the schema

Supabase → SQL Editor → New query → paste [`db/apply-all.sql`](../db/apply-all.sql)
→ Run.

Until this is done every table returns 404 and the dashboards show errors. It is
idempotent, so re-running while iterating is safe.

### 2. Set the database timezone

```sql
alter database postgres set app.timezone = 'Asia/Kolkata';
```

The lateness rule defaults to `Asia/Kolkata` inside the trigger, but setting it
on the database makes it explicit and survives a restore.

> This matters more than it looks. The **old** system built the shift start as
> `(date + start_time) at time zone 'UTC'`, which treats a local rota time as
> UTC — a 5h30m error in IST, so `is_late` was **always false** and nobody was
> ever marked late. Worse, punctuality points are awarded when `is_late` is
> false, so every on-site check-in earned them regardless of arrival time. The
> new trigger reads `app.timezone` instead.

### 3. Create the accounts

```bash
node --env-file=db/.env db/tools/create-accounts.mjs
```

Needs `SUPABASE_SERVICE_ROLE_KEY` and `DEMO_PASSWORD` in `db/.env`. The service
key is not avoidable here: the publishable key can only reach
`/auth/v1/signup`, which leaves the account unconfirmed (this project has
`mailer_autoconfirm` off, so it cannot sign in) and cannot set a role. Only the
admin API creates a confirmed user outright.

The script refuses to run before step 1, deliberately. An auth user created
before `public.profiles` exists is orphaned — the trigger that would have
written its profile does not exist yet, and nothing backfills it later, leaving
an account that signs in to a broken session.

Everyone starts with `password_created = false`, so the first sign-in is
redirected to `/set-password`.

### 4. Rotate the onboarding password

The old value was committed to a public repository and is in git history.
Removing it from the working tree did not remove it from history — change
`ONBOARDING_PASSWORD` to something new in both Vercel and `frontend/.env.local`.

---

## Verified

`npx next build` completes clean on Next 16.2.10 / Turbopack — 8 static pages,
6 dynamic routes, proxy middleware, TypeScript passing. `npx eslint .` reports
zero errors and zero warnings.
