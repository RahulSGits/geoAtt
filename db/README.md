# geoAtt — database

Schema for the **new** Supabase project. The old project in `../supabase` keeps
serving until cutover and is not touched by anything here.

At cutover this folder becomes `supabase/migrations/` and the old one is
archived. It is separate now so a mistake here cannot affect production.

## Applying

Run in filename order, **one file at a time**, in the SQL Editor or via `psql`.
Every file is idempotent, so re-running is safe.

```bash
for f in db/migrations/*.sql; do psql "$SUPABASE_DB_URL" -f "$f"; done
```

`0001` must **commit before `0002` runs**. Postgres cannot use a value of an
enum in the same transaction that created the enum — the old project hit exactly
this when it added `'admin'` and referenced it in one go. Running file-by-file
handles it; wrapping the whole set in one transaction does not.

Set the timezone once, before any attendance exists:

```sql
alter database postgres set app.timezone = 'Asia/Kolkata';
```

## What each file does

| File | Contents |
| --- | --- |
| `0001` | Extensions, enums |
| `0002` | `profiles`, `departments`, role-escalation guard |
| `0003` | `sites`, `shifts` |
| `0004` | `employees`, `face_templates` |
| `0005` | `attendance` + the status/lateness trigger |
| `0006` | `leave_types`, `leaves` + overlap exclusion |
| `0007` | `announcements`, `notifications` |
| `0008` | `reward_events` + balance sync |
| `0009` | `audit_log` + audit triggers |
| `0010` | Read-model views |
| `0011` | **RLS** — every policy, in one reviewable place |
| `0012` | RPCs (role changes, enrolment, deletion, rewards) |
| `0013` | Storage buckets and their policies |

## Carried over unchanged

These were correct in the old system and are ported deliberately:

- The **Present / Half / Absent / Pending ladder**, and its deference to
  `manual_override` so an HR correction is not immediately recomputed away.
- **`is_hr()` / `is_admin()` / `current_employee_id()`** as `SECURITY DEFINER`
  predicates. This is not a style choice — see below.
- **The role-escalation guard**: a user may edit their own profile but never
  their own `role`.
- **Last-administrator protection** in `set_member_role`.
- **One-shot face enrolment**, now atomic.
- **Descriptors, never photographs**, as the identity anchor.
- **Notifications scoped by explicit `recipient_id`** as well as by RLS.

### The recursion trap — do not undo this

A policy on `profiles` that `SELECT`s `profiles` re-enters its own policy:

```
42P17: infinite recursion detected in policy for relation "profiles"
```

In the old project that made **every** query return HTTP 500 and every dashboard
render zeros; a whole migration existed to undo it. `SECURITY DEFINER` functions
do not re-enter RLS, which is what breaks the cycle. Never inline
`(select role from public.profiles where id = auth.uid())` into a policy on
`profiles` — call the helpers.

Views carry `security_invoker = on` for the mirror-image reason: without it a
view runs as its owner and silently bypasses RLS, so an employee querying
`v_employee_directory` would see the whole company.

## Redesigned, and why

| Change | Reason |
| --- | --- |
| `profiles` / `employees` split by ownership | Six columns lived in both with nothing syncing them — a phone number updated in one went stale in the other |
| `face_templates` as its own table | Descriptors sat on the hot roster row; `select('*')` shipped ~6 MB of unused vectors per HR dashboard load at 600 employees |
| `departments` as a table | Was free text, so `Ops` / `ops` / `Operations` were three departments with no rename or merge |
| `leave_types.is_wfh` flag | Was inferred by regex on free text, so `Work From Home (India)` behaved differently from `WFH` |
| Views for aggregates | KPIs and the 14-day trend were computed in JavaScript from whole tables |
| `audit_log` | Only deletions were audited; role changes, overrides and leave decisions left no trail |
| Overlap exclusion on `leaves` | Overlap was checked in the UI only |
| Enums for status fields | `active` / `Active` / `ACTIVE` were three states |
| `citext` email | Replaces a `lower(email)` index that failed to create wherever duplicates already existed |
| Partial indexes on pending queues | The approval queues read one value of a column that is uniform elsewhere |

## A bug found while porting — fixed here, still live in the old system

`compute_attendance_status` built the shift start as:

```sql
shift_start := (new.date + s.start_time) at time zone 'UTC';
```

That interprets a **local** rota time as UTC. In IST it is 5h30m out, so a 09:00
shift is compared against 14:30 local — and **nobody is ever marked late**.

It compounds: `employee/actions.ts` awards punctuality points when
`is_late === false`, which is always. So every on-site check-in has been earning
reward points regardless of how late it was.

Fixed in `0005` by resolving against `app.timezone`. The old system needs the
same one-line fix independently of the rebuild.

## Data migration

A separate one-off script, not a migration — the old project keeps serving until
cutover. Order matters because of the foreign keys:

1. `departments` — distinct values from the old free-text column, normalised
2. `sites`, `shifts`, `leave_types`
3. `profiles` — identity columns only
4. `employees` — employment columns only, `department` resolved to `department_id`
5. `face_templates` — lifted out of the old `face_descriptor` jsonb, one row per
   pose. Old rows hold either a flat descriptor or an array of them; both shapes
   must be handled
6. `attendance`, `leaves`, `reward_events`, `announcements`

**Face descriptors are the hard constraint.** They came from face-api's
`faceRecognitionNet` and are only comparable to descriptors from that same
model, so it is pinned in `face_templates.model`. Changing the model means all
600 employees re-enrol.

## Environment

Never hardcoded. `.env.example` holds placeholders; real values go in a
gitignored `.env`:

```bash
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
APP_TIMEZONE=Asia/Kolkata
```
