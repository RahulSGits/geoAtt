# FinAtt — Attendance & Workforce Platform

A Next.js 16 web app for face-verified, geofenced attendance, backed entirely by Supabase.

Employees enroll their face once, then check in with a live selfie. Every check-in is
validated three ways — a 128-float face descriptor match, a blink liveness gate, and a GPS
geofence — with the face match and the fence **re-checked on the server**, so a forged
client request cannot mark someone present. Worked hours, lateness and the daily status
(Present / Half day / Late / WFH / Absent) are computed by a Postgres trigger.

FinAtt is an internal tool: there is no public sign-up. Accounts are created by an
administrator, who also decides which portal each person lands on.

## Tech Stack

- **Frontend** — Next.js 16 (App Router, React 19, React Compiler, Turbopack), Tailwind CSS v4, `motion`, Recharts, React-Leaflet
- **Backend** — Supabase (Postgres, Auth, Row Level Security, triggers, Realtime, Storage)
- **Face pipeline** — MediaPipe Tasks Vision `FaceLandmarker` for detection, framing and blink liveness; `@vladmandic/face-api` `faceRecognitionNet` for the 128-float identity descriptor. Both run client-side against self-hosted weights in `public/`
- **Email** — Resend, for invites, leave decisions and password-reset links
- **AI assistant** — Google Gemini, grounded on the signed-in user's own data

---

## Roles

| Role | Portal | Can do |
| ---- | ------ | ------ |
| **Employee** | `/employee` | Check in/out, request leave, view own attendance, edit own profile |
| **HR** | `/hr` | Everything about people: roster, attendance, leave, sites, shifts, announcements. Sees the member directory and can onboard employees and send reset links |
| **Admin** | `/admin` | Everything HR can, plus assign portals, invite HR/admins, sign-in activity and diagnostics |

Admin is a superset of HR — the database's `is_hr()` returns true for both, and the app's
`roleSatisfies()` mirrors that. `employee` stays exact: an admin has no `employees` row, so
employee-only actions (check-in, leave) correctly reject them.

The last administrator cannot be demoted, enforced in Postgres by `set_member_role`, not
just in the UI.

---

## Setup

### 1. Database

Open your Supabase project → **SQL Editor** and run, in filename order:

```text
supabase/migrations/20260721000000_finatt_full_schema.sql   ← start here
supabase/migrations/2026072200…  through  2026073300…
```

Every migration is idempotent, so re-running is safe.

The first migration is not optional. It fixes a `42P17: infinite recursion detected in
policy for relation "profiles"` in the original schema, where the HR policy on `profiles`
queried `profiles`. Until it is applied **every** query returns HTTP 500 and the dashboards
show zeros behind a red banner.

Two migrations need care:

- `20260730000000_admin_role.sql` only adds an enum value. Postgres cannot use a new enum
  value in the transaction that created it, so it must be committed before any later
  migration references `'admin'`. Running the files one at a time handles this.
- `20260733000000_notifications_for_all.sql` needs Realtime enabled for the project
  (**Database → Replication**) for live notifications; without it everything still works,
  just on refresh rather than instantly.

Prefer to automate it? See [Scripts](#scripts).

### 2. Environment

Copy `frontend/.env.example` to `frontend/.env.local` and fill it in:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable / anon key>

# Creating logins, sending invites and generating reset links.
SUPABASE_SERVICE_ROLE_KEY=<secret / service_role key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Email. EMAIL_FROM must be quoted — the angle brackets are shell redirects otherwise.
RESEND_API_KEY=<resend key>
EMAIL_FROM="FinAtt <noreply@yourdomain.com>"

# Optional: the AI assistant, and the Google Maps provider for the site editor.
GEMINI_API_KEY=<key>
GEMINI_MODEL=<pin one model; otherwise a fallback chain self-heals>
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<key>

# Optional: lets scripts/fix-all.sh apply migrations over the Management API.
SUPABASE_ACCESS_TOKEN=<personal access token, sbp_…>
```

Both Supabase keys come from **Project Settings → API keys**. Only the first two are
mandatory; without the rest everything works except invites and the assistant, and the
admin console's **Diagnostics** tab says exactly what is missing.

> **Check the key belongs to this project.** A service key copied from another Supabase
> project is a perfectly valid JWT, so a naive "is it set?" check passes while every call
> it makes returns 401 — which surfaces as invites mysteriously falling back to signup.
> Diagnostics decodes the key's project ref and compares it to your URL, and names both if
> they differ.

### 3. Run

```bash
cd frontend
npm install
npm run dev
```

> The camera needs a secure context. `localhost` counts; any other host needs HTTPS.

---

## Accounts and passwords

### The first administrator

There is no public sign-up, and `/register` no longer exists — so the first admin has to be
created out of band:

```bash
./scripts/create-admin.sh you@company.com
```

It prompts for a password (not echoed), enforces 12+ characters with mixed case, a digit
and a symbol, and stores only a bcrypt hash at cost 12. The password never reaches a
command line, a file, or the process list. See [Scripts](#scripts).

### Everyone else

Administrators invite people from **Members & access → Invite member**. New HR and employee
accounts start on a shared default password:

```text
finbud@123
```

They sign in with it and get **exactly one** self-service change, made from **My Profile**.
Changing it requires the current password, so someone who finds an unattended session
cannot spend that one change and lock the owner out.

Once spent, the form closes. Only an administrator's **Send reset link** reopens it — which
is the point: a shared starting password must not also become a permanent self-service
password-change surface.

Employees can sign in with **either** their email address or their employee ID (`EMP-0001`),
resolved server-side. A miss falls through to the normal sign-in and returns the same
generic message as a wrong password, so the field cannot be used to enumerate which IDs
exist. *(Requires `20260732000000_login_by_employee_id.sql`.)*

### Reset links

**Members & access → Send reset link** generates a recovery link through GoTrue and mails it
via Resend. The administrator never sees or chooses the member's password, and the member's
existing password keeps working until the link is used. If email is unconfigured the link
is returned and copied to the clipboard instead, so the reset can still happen.

> Resend's sandbox sender `onboarding@resend.dev` only delivers to your own Resend account
> address. Invites to anyone else are accepted by the API and silently never arrive. Verify
> a domain at resend.com/domains and set `EMAIL_FROM` to an address on it before onboarding
> real staff.

---

## Features

### Employee portal
- Live check-in card with today's status, hours and lateness
- One-time face enrollment across four poses — centre, left, right, up
- Verified check-in and check-out: GPS fence → face match → blink liveness → selfie stored privately
- Work mode per day: on-site or remote, where the site and shift allow it
- Reward points for punctual, in-geofence check-ins, with a running balance
- Re-check-in requests after checking out, subject to HR approval
- Month calendar plus a full history table, exportable to CSV
- Leave requests with overlap detection and withdrawal
- Live notifications and announcements, delivered over Supabase Realtime

### HR console
- KPIs, a 14-day attendance trend, status mix and department headcount
- Employee directory: add, edit, assign site + shift, delete, re-grant a face enrollment
- **CSV import** — headers matched by alias, quoted fields and `DD/MM/YYYY` dates handled, duplicates skipped with a reason
- Attendance across the company with filters and CSV export; HR-only editing of status and in/out times
- Leave approvals — approving posts those days to the sheet, emails the employee, and marks WFH leave as *WFH* rather than *On leave*
- Re-check-in approvals
- Announcements with priority levels
- **Work sites by kind** — *Office* (geofenced, map editor with radius, address geocoding, and Leaflet/Google Maps providers), *Remote* (no location check), or *Hybrid*
- Shifts: working days, work mode, grace period, and the thresholds driving Present/Half/Absent
- Member directory: onboard employees, send reset links *(portal assignment is admin-only)*

### Admin console
Everything above, plus **Members & access** (assign portals, invite HR and admins),
**Sign-in activity**, and **Diagnostics** — which reports the state of the service key,
email, site URL and AI configuration, and names the specific fault rather than just
"missing".

---

## How verification works

| Layer | Where it runs | What it stops |
| ----- | ------------- | ------------- |
| Face descriptor match | Browser **and** re-checked server-side against the stored template | Someone else checking in for you |
| Blink liveness | Browser, via MediaPipe blendshapes across frames | A printed photo or a phone screen |
| Geofence | Browser **and** re-checked server-side with haversine | Checking in from home |
| GPS accuracy gate | Both | A vague fix being treated as precise |
| Row Level Security | Postgres | Reading anyone else's records |

Face data is stored as a 128-float descriptor, never as a reference photograph — the numbers
cannot be turned back into an image, so there is no photo library to leak. Check-in selfies
live in a private bucket readable only by their owner and HR.

Notifications are scoped to their recipient by an explicit `recipient_id` filter as well as
by RLS, so a policy widened later cannot quietly put the whole company's feed in one
person's bell.

---

## Scripts

All three read `frontend/.env.local`, which is gitignored, and never print or pass a secret
on a command line.

| Script | Needs | Does |
| ------ | ----- | ---- |
| `scripts/create-admin.sh [email]` | `SUPABASE_DB_URL` | Creates or promotes an administrator. Prompts for the password; stores only a bcrypt hash |
| `scripts/apply-db.sh [--check]` | `SUPABASE_DB_URL` | Applies every migration, the seed and the login repair over `psql`. `--check` reports state and changes nothing |
| `scripts/fix-all.sh [--check]` | `SUPABASE_ACCESS_TOKEN` | Same, over the Supabase Management API — no database password needed |

`SUPABASE_DB_URL` comes from **Project Settings → Database → Connection string → URI**.
`SUPABASE_ACCESS_TOKEN` is a personal access token from
[supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).

### Troubleshooting: HTTP 500 "Database error querying schema" on sign-in

An account whose `auth.users` row was inserted by hand-written SQL that omitted the token
columns. GoTrue reads those into a Go `string`, which cannot hold NULL, so it fails to scan
the row and returns 500 before the password is ever checked — no password will work.

```bash
# Supabase → SQL Editor → paste → Run
supabase/FIX_LOGIN_500.sql
```

It only replaces NULLs, is safe to re-run, and ends with a query where every row must read
`ok`.

---

## Project layout

```text
frontend/
  src/
    app/
      (auth)/          login, set-password + auth actions
      (main)/employee/ employee portal + its server actions
      (main)/hr/       HR console, sections/, + its server actions
      (main)/admin/    admin console (renders the HR client with admin tiers)
      api/chat/        Gemini assistant, scoped to the caller's data
    components/        shell, modal, toasts, face check-in, map, charts, UI kit
    lib/               types, geo maths, face pipeline, formatting, auth guards, service-key checks
    proxy.ts           auth + role routing (Next 16's renamed middleware)
scripts/               create-admin.sh, apply-db.sh, fix-all.sh
supabase/
  migrations/          schema, RLS, triggers, storage, realtime
  create_admin.sql     parameterised — run via scripts/create-admin.sh
  FIX_LOGIN_500.sql    repairs unreadable auth.users rows
```

## License

MIT
