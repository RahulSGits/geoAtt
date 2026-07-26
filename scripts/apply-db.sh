#!/usr/bin/env bash
#
# Applies every pending FinAtt migration to the Supabase database, in order.
#
# Reads the connection string from SUPABASE_DB_URL in frontend/.env.local, which
# is gitignored. The value is never printed, never passed on a command line
# another process could see in `ps`, and never written anywhere else.
#
#   ./scripts/apply-db.sh          # apply everything
#   ./scripts/apply-db.sh --check  # connect and report state, change nothing
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/frontend/.env.local"
CHECK_ONLY=false
[ "${1:-}" = "--check" ] && CHECK_ONLY=true

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

# Pull out just this one variable; avoid sourcing the whole file so an unrelated
# value containing shell metacharacters cannot execute anything.
SUPABASE_DB_URL="$(grep -E '^SUPABASE_DB_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  cat >&2 <<'MSG'
error: SUPABASE_DB_URL is not set in frontend/.env.local

  Supabase dashboard -> Project Settings -> Database -> Connection string -> URI
  Copy it, replace [YOUR-PASSWORD] with your database password, and add:

    SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres"

MSG
  exit 1
fi

# Everything below uses PGPASSWORD-style env passing, so the URL never appears
# in the process list.
export PGCONNECT_TIMEOUT=15
run_sql() { psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

echo "Connecting..."
if ! run_sql -tAc 'select 1' >/dev/null 2>&1; then
  echo "error: could not connect. Check the password and that the host is reachable." >&2
  exit 1
fi
echo "Connected to $(run_sql -tAc 'select current_database()' 2>/dev/null)."
echo

echo "=== Current state ==="
run_sql <<'SQL'
select
  u.email,
  case
    when u.confirmation_token is null
      or u.recovery_token is null
      or u.email_change is null
      or u.email_change_token_new is null then 'BROKEN: null tokens'
    when u.email_confirmed_at is null then 'BROKEN: email unconfirmed'
    when not exists (
      select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
    ) then 'BROKEN: no identity'
    else 'ok'
  end as sign_in_status,
  coalesce(p.role::text, '(no profile)') as role
from auth.users u
left join public.profiles p on p.id = u.id
order by u.email;
SQL
echo

if $CHECK_ONLY; then
  echo "--check given; nothing was modified."
  exit 0
fi

# ---------------------------------------------------------------------------
# Migrations, in filename order. The timestamps already encode the dependency
# order, including the enum value in 20260730 landing before its first use.
# Each file runs on its own so a failure names the exact file.
# ---------------------------------------------------------------------------
echo "=== Applying migrations ==="
failed=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  printf '  %-52s ' "$name"
  if out=$(run_sql -f "$f" 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    echo "$out" | sed 's/^/      /' | tail -6
    failed=$((failed + 1))
  fi
done
echo

echo "=== Seeding roles and repairing logins ==="
for f in "$ROOT/supabase/seed_demo_roles.sql" "$ROOT/supabase/FIX_LOGIN_500.sql"; do
  name="$(basename "$f")"
  [ -f "$f" ] || continue
  printf '  %-52s ' "$name"
  if out=$(run_sql -f "$f" 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    echo "$out" | sed 's/^/      /' | tail -6
    failed=$((failed + 1))
  fi
done
echo

echo "=== Final state (every row must read ok) ==="
run_sql <<'SQL'
select
  u.email,
  case
    when u.confirmation_token is null
      or u.recovery_token is null
      or u.email_change is null
      or u.email_change_token_new is null then 'BROKEN: null tokens'
    when u.email_confirmed_at is null then 'BROKEN: email unconfirmed'
    when not exists (
      select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
    ) then 'BROKEN: no identity'
    else 'ok'
  end as sign_in_status,
  coalesce(p.role::text, '(no profile)') as role
from auth.users u
left join public.profiles p on p.id = u.id
order by u.email;
SQL

echo
if [ "$failed" -gt 0 ]; then
  echo "$failed file(s) failed — see the errors above."
  exit 1
fi
echo "All applied."
