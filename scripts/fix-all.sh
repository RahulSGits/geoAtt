#!/usr/bin/env bash
#
# Repairs the database over the Supabase Management API.
#
# This is the only route left that can reach the auth schema without the
# database password: PostgREST never exposes auth.*, and every GoTrue admin
# endpoint has to read the broken row before it can touch it, so all of them
# fail with "Database error loading user" on exactly the rows that need fixing.
#
# Needs SUPABASE_ACCESS_TOKEN (a personal access token, sbp_...) in
# frontend/.env.local. Generate one at:
#   https://supabase.com/dashboard/account/tokens
#
#   ./scripts/fix-all.sh          # repair + apply the missing migration
#   ./scripts/fix-all.sh --check  # report state only, change nothing
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/frontend/.env.local"
# Derived from the project URL rather than hardcoded, so this repo carries no
# reference to one particular Supabase project.
PROJECT_REF="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" 2>/dev/null \
  | head -1 | sed -E 's|.*https://([a-z0-9]+)\.supabase\..*|\1|')"
API="https://api.supabase.com/v1/projects/$PROJECT_REF/database/query"
CHECK_ONLY=false
[ "${1:-}" = "--check" ] && CHECK_ONLY=true

getenv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"''; }

TOKEN="$(getenv SUPABASE_ACCESS_TOKEN)"
if [ -z "$TOKEN" ]; then
  cat >&2 <<'MSG'
error: SUPABASE_ACCESS_TOKEN is not set in frontend/.env.local

  1. Open https://supabase.com/dashboard/account/tokens
  2. "Generate new token", name it anything, copy it (shown once)
  3. Add to frontend/.env.local:

       SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxx

MSG
  exit 1
fi

# Runs one SQL string. The query is sent as a JSON body, so nothing lands in
# the process list; jq builds the JSON so quoting in the SQL cannot break it.
run_sql() {
  local sql="$1"
  jq -n --arg q "$sql" '{query:$q}' \
  | curl -s -X POST "$API" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @-
}

run_file() {
  local f="$1"
  printf '  %-46s ' "$(basename "$f")"
  local out; out="$(run_sql "$(cat "$f")")"
  if echo "$out" | jq -e 'type == "object" and has("message")' >/dev/null 2>&1; then
    echo "FAILED"
    echo "$out" | jq -r '.message' | sed 's/^/      /'
    return 1
  fi
  echo "ok"
}

command -v jq >/dev/null || { echo "error: jq is required (brew install jq)" >&2; exit 1; }

echo "=== Connecting ==="
probe="$(run_sql 'select current_database() as db')"
if echo "$probe" | jq -e 'type == "object" and has("message")' >/dev/null 2>&1; then
  echo "error: $(echo "$probe" | jq -r '.message')" >&2
  echo "       If it mentions authorization, the token is wrong or revoked." >&2
  exit 1
fi
echo "Connected to $(echo "$probe" | jq -r '.[0].db // "?"')."
echo

STATUS_SQL="
select u.email,
       case
         when u.confirmation_token is null
           or u.recovery_token is null
           or u.email_change is null
           or u.email_change_token_new is null then 'BROKEN: null tokens'
         when u.email_confirmed_at is null then 'BROKEN: unconfirmed'
         when not exists (select 1 from auth.identities i
                           where i.user_id = u.id and i.provider = 'email')
           then 'BROKEN: no identity'
         else 'ok'
       end as sign_in_status,
       coalesce(p.role::text, '(no profile)') as role
  from auth.users u
  left join public.profiles p on p.id = u.id
 order by u.email;"

echo "=== Before ==="
run_sql "$STATUS_SQL" | jq -r '.[] | "  \(.email)  \(.sign_in_status)  [\(.role)]"' 2>/dev/null \
  || run_sql "$STATUS_SQL"
echo

if $CHECK_ONLY; then
  echo "--check given; nothing was modified."
  exit 0
fi

echo "=== Repairing auth rows ==="
failed=0
run_file "$ROOT/supabase/FIX_LOGIN_500.sql" || failed=$((failed+1))
echo

echo "=== Applying the missing migration ==="
run_file "$ROOT/supabase/migrations/20260732000000_login_by_employee_id.sql" || failed=$((failed+1))
echo

echo "=== After (every row must read ok) ==="
run_sql "$STATUS_SQL" | jq -r '.[] | "  \(.email)  \(.sign_in_status)  [\(.role)]"' 2>/dev/null \
  || run_sql "$STATUS_SQL"

echo
[ "$failed" -eq 0 ] && echo "All applied." || { echo "$failed step(s) failed."; exit 1; }
