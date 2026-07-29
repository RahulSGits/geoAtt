# geoAtt — Phase 1: Analysis of the Existing System

Written before any rebuild work. Every number here was measured against the
current tree, not estimated.

---

## 1. What exists today

| Area | Reality |
| --- | --- |
| Web | Next.js 16 App Router, React 19, Tailwind v4. **18,380 lines** across `frontend/src` |
| API | None. Server Actions talk to Supabase directly — 29 HR, 7 employee, 4 auth |
| Database | Supabase Postgres. 17 migrations, **2,141 lines** of SQL |
| Schema | 9 tables, **15 indexes**, **25 functions**, 5 triggers, **48 RLS policies**, **0 views** |
| Face | MediaPipe FaceLandmarker + `@vladmandic/face-api`, entirely client-side, 38 MB of weights |
| Mobile | `mobile/` (Capacitor shell) and `mobile-rn/` (Expo) — two parallel attempts |
| Dead code | `backend/` (NestJS, 9 files) and `fastapi-backend/` (5 files) — **never referenced** |

### What is genuinely good — and must survive the rebuild

I went looking for missing authorization and did not find it. This is a
better-built system than a rewrite brief usually implies:

- **28 of 29 HR server actions call `requireRole()`.** I initially measured zero
  because I grepped for the wrong helper names; the real coverage is near-total.
- **Check-in is re-validated server-side.** The face descriptor is compared
  against the stored template *on the server* (`employee/actions.ts`), and the
  geofence is re-computed with haversine. A forged client request cannot mark
  someone present. This is the security core of the product and it is correct.
- **Faces are stored as 128-float descriptors, never as reference photographs.**
  There is no photo library to leak.
- **Notifications are scoped by an explicit `recipient_id` filter *and* RLS** —
  defence in depth, so a policy widened later cannot leak the company's feed.
- **Both API routes authenticate** (`/api/chat`, `/api/geocode`) and return 401.
- **Attendance status is computed by a Postgres trigger**, not in the client, so
  it cannot be spoofed and cannot drift between callers.

**Recommendation: keep all of the above logic essentially as-is.** Port it;
don't redesign it. The problems are elsewhere.

---

## 2. Schema findings

### 2.1 `profiles` and `employees` duplicate six business columns — P0

`profiles` has 11 columns, `employees` has 14, and these six exist in **both**
with no synchronisation:

```
full_name   email   phone   department   designation   profile_image
```

Update a person's phone number in one place and the other is silently stale.
Nothing in the schema — no trigger, no constraint — keeps them agreeing. Which
one the UI reads is essentially arbitrary per screen.

**Fix:** `profiles` owns identity (name, email, phone, avatar). `employees` owns
employment (code, department, designation, joining date, site, shift). One
column, one home, joined at read time.

### 2.2 `face_descriptor` sits on the hot roster row — P0

The descriptor is a `jsonb` column on `employees`: 128 floats per enrolled pose,
up to 4 poses ≈ 512 numbers ≈ **~10 KB of JSON per employee**.

`frontend/src/app/(main)/hr/page.tsx:78` does:

```ts
supabase.from('employees').select('*').order('created_at', { ascending: false })
```

No column list. No `limit`. No pagination. The page is `force-dynamic`, so
nothing is cached. **At 600 employees that is roughly 6 MB of face vectors
serialised on every single HR dashboard load** — data the dashboard never
renders.

**Fix:** move templates to their own `face_templates` table keyed by employee.
The roster query then physically cannot touch them.

### 2.3 `department` is free text — P1

It is a `text` column on two tables. There is no `departments` table, so there
is no rename, no merge, no validity guarantee — "Ops", "ops" and "Operations"
are three departments. The brief asks for Departments management, which needs a
real table.

### 2.4 No views, so aggregation happens in JavaScript — P1

Zero views, zero materialised views. The HR dashboard pulls whole tables and
computes KPIs, the 14-day trend and the status mix in the client. That is a
table scan shipped over the wire to do work Postgres does better.

**Fix:** `v_attendance_daily`, `v_department_headcount`, `v_leave_pending` as
views or RPCs; the dashboard reads rows already reduced.

### 2.5 Unbounded queries — P0

Same file, same load: `leaves` is fetched with **no date filter and no limit**.
Attendance is windowed to `HISTORY_DAYS`; leaves and announcements are not. This
table grows forever, so the dashboard gets monotonically slower for the life of
the deployment.

### 2.6 Missing indexes for the queries the UI actually runs — P1

15 indexes exist and the important attendance ones are right
(`(employee_id, date desc)`, `(date desc)`). Missing: `employees(status)` and
`employees(department)`, both filtered by the directory on every load.

### 2.7 Audit coverage is deletion-only — P1

There is a `deletion_audit` table and nothing else. The brief asks for Audit
Logs as a first-class feature: role changes, attendance overrides, leave
decisions and face-enrolment grants are all privileged actions that currently
leave no trail.

---

## 3. Security findings

| # | Severity | Finding |
| --- | --- | --- |
| S1 | **High** | `DEFAULT_PASSWORD` is a hardcoded literal in `lib/types.ts` — and this repository is **public**. Every new HR and employee account starts on it, and because `lib/types.ts` is imported by `'use client'` components it also shipped in the browser bundle. **Fixed in a later commit; the value must still be rotated, because git history is public.** |
| S2 | Low | `getEmailCapability()` is the one server action with no guard. Server Actions are POST endpoints reachable by anyone who knows the action ID, so it leaks two deployment-config booleans to unauthenticated callers. |
| S3 | Medium | No application-level rate limiting on sign-in. `/api/geocode` throttles and `lib/reauth.ts` throttles, but the login path relies entirely on Supabase's own limits. |
| S4 | Medium | The service-role key is used in four places. Each use is justified (inviting users, writing rows before a session exists), but it bypasses **all** RLS, so each call site is a place where a missing role check becomes total compromise. Currently guarded — needs to stay that way, and should move behind the FastAPI backend. |

S1 is the one to fix before anything else, and it is a five-minute fix
independent of the rebuild: generate a per-invite random password.

---

## 4. Performance findings

Ranked by impact at 600 employees:

1. **HR dashboard payload** (§2.2 + §2.5) — ~6 MB of unused face vectors plus
   an unbounded leaves table, uncached, on every load. This is the single
   biggest scale blocker.
2. **Aggregation in the client** (§2.4) — whole tables shipped to compute a
   handful of numbers.
3. **`select('*')` in 15 places**, including `lib/auth.ts:110`, which pulls the
   descriptor on *every authenticated request*.
4. **38 MB of face weights** downloaded on first check-in. `/models` is served
   `immutable`; `/mediapipe` (25 MB) is not, so the WASM refetches whenever the
   cache is evicted — a one-line header fix.

---

## 5. Code quality findings

| File | Lines | Problem |
| --- | --- | --- |
| `hr/actions.ts` | 2,416 | 29 unrelated actions in one module |
| `EmployeeDashboardClient.tsx` | 1,179 | One component: check-in, calendar, leave, profile, password |
| `MembersSection.tsx` | 1,002 | Same |
| `EmployeesSection.tsx` | 726 | Same |

Also: two dead backend folders that no code imports, and two competing mobile
apps. The brief's `apps/` + `packages/` layout fixes the structural half of
this; splitting by domain fixes the rest.

---

## 6. Migration path to the new Supabase project

The brief says *fresh schema, do not reuse old SQL*. Agreed — but the **business
logic** in that SQL is correct and hard-won, and should be carried across
deliberately rather than rewritten from memory.

### Carry over, essentially unchanged

- `compute_attendance_status` — the Present/Half/Late/Absent trigger
- `is_hr()` / `is_admin()` / `current_employee_id()` — the RLS predicate helpers
- `profiles_guard_role` — blocks self-escalation of `role`
- `set_member_role` — refuses to demote the last administrator
- `claim_face_enroll_attempt` — enforces one-shot enrolment
- `award_points` — punctuality rewards
- The 48 RLS policies, re-derived against the new table shapes

### Redesign

1. Split `profiles` / `employees` by ownership (§2.1)
2. `face_templates` as its own table (§2.2)
3. `departments` as a real table with an FK (§2.3)
4. `audit_log` covering every privileged action (§2.7)
5. Views for dashboard aggregates (§2.4)
6. Add the two missing indexes (§2.6)

### Ordered migration files

```
0001_extensions_and_enums.sql
0002_identity.sql            profiles, departments
0003_org.sql                 sites, shifts
0004_employees.sql           employees, face_templates
0005_attendance.sql          attendance + compute trigger
0006_leaves.sql
0007_comms.sql               announcements, notifications
0008_rewards.sql
0009_audit.sql
0010_views.sql
0011_rls.sql                 every policy, in one reviewable place
0012_rpc.sql
0013_storage.sql             avatars, attendance-selfies, documents, csv-imports
```

Data migration is a separate one-off script, not a migration: the old project
keeps serving until cutover, then a script copies rows, splitting the duplicated
columns per §2.1 and lifting descriptors into `face_templates`.

**Credentials go in `.env` files only.** The URL and publishable key you sent
will go into `.env.example` as placeholders with the real values in gitignored
`.env` — this repository is public.

---

## 7. Proposed phase order

| Phase | Deliverable |
| --- | --- |
| 1 | **This document** ✅ |
| 2 | Monorepo skeleton (`apps/`, `packages/`), design tokens, shared types |
| 3 | New Supabase schema — the 13 migrations above, with RLS |
| 4 | FastAPI backend — clean architecture, the modules in the brief |
| 5 | Web app — Next.js 16, shadcn/ui, Motion, TanStack Query, Zustand |
| 6 | Mobile app — Expo, NativeWind, Reanimated, camera/location |
| 7 | Face pipeline hardening, data migration script, deployment docs |

Phases 3–6 each need their own review before the next begins. I will not start
Phase 2 until you have read this and told me where you disagree.

---

## 8. Open questions

1. **`DEFAULT_PASSWORD` is public.** Do you want me to fix that in the current
   app now, independently of the rebuild? It is a real exposure today.
2. **Two mobile apps exist.** The rebuild targets one Expo app. Confirm I should
   delete `mobile/` (Capacitor) and rebuild `mobile-rn/` into `apps/mobile`.
3. **Face descriptors are the migration's hard constraint.** `face-api`'s
   `faceRecognitionNet` produced every stored template. Changing the embedding
   model means **all 600 employees re-enrol**. Do you want to keep the model
   (safe, no re-enrolment) or upgrade it (better accuracy, full re-enrolment)?
4. **Firebase vs Supabase for mobile.** `mobile-rn` currently authenticates
   against Firebase. The brief says Supabase Auth everywhere. I will move it to
   Supabase unless you say otherwise — which makes the Firebase project you set
   up unnecessary.
