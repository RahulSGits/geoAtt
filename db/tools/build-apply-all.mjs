/**
 * Concatenates db/migrations into a single db/apply-all.sql.
 *
 *   node db/tools/build-apply-all.mjs
 *
 * Exists because applying the schema needs either a database password or a
 * management token, and neither is required to paste one file into the
 * Supabase SQL Editor. That makes the editor the lowest-friction path to a
 * schema, and this keeps the pasted file honestly derived from the numbered
 * migrations rather than maintained twice.
 *
 * Re-run after editing any migration. Check the result with
 * db/tools/check-migrations.mjs first — this does no validation of its own.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'migrations')
const OUT = join(ROOT, 'apply-all.sql')

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

const HEADER = `-- ============================================================================
-- geoAtt — complete schema for a fresh Supabase project, in one file.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. It takes a few seconds. Re-running is safe: every statement is
--   idempotent (create if not exists / create or replace / drop policy if
--   exists), so it can be applied repeatedly while iterating.
--
-- WHAT IT CREATES
--   8 enum types, 13 tables, 5 views, 24 functions, the triggers that own
--   attendance status and the audit trail, every RLS policy, and 4 private
--   storage buckets.
--
-- AFTER RUNNING
--   1. Set the timezone the lateness rule reasons in. Without this it defaults
--      to Asia/Kolkata inside the trigger, but setting it on the database makes
--      it explicit and survives a restore:
--        alter database postgres set app.timezone = 'Asia/Kolkata';
--   2. Promote your first administrator — there is no public sign-up:
--        update public.profiles set role = 'admin' where email = 'you@company.com';
--
-- This is generated. Edit db/migrations/*.sql and re-run:
--   node db/tools/build-apply-all.mjs
-- ============================================================================

`

const bar = '='.repeat(74)
const body = files
  .map((f) => `\n-- ${bar}\n-- FILE: ${f}\n-- ${bar}\n${readFileSync(join(DIR, f), 'utf8')}`)
  .join('')

writeFileSync(OUT, HEADER + body)

const lines = (HEADER + body).split('\n').length
console.log(`wrote db/apply-all.sql — ${files.length} migrations, ${lines} lines`)
