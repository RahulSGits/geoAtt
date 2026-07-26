#!/usr/bin/env bash
#
# Creates (or promotes) an administrator account.
#
# The password is typed at the prompt, never passed as an argument and never
# written to a file:
#   * `read -s` keeps it off the screen and out of shell history
#   * it reaches psql over stdin, so it never appears in `ps` output
#   * psql's :'var' quoting turns it into a SQL literal safely, so a quote or
#     backslash in the password cannot break out into SQL
#   * only the bcrypt hash is ever stored
#
#   ./scripts/create-admin.sh                 # prompts for everything
#   ./scripts/create-admin.sh me@company.com  # prompts for the password only
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/frontend/.env.local"
MIN_LEN=12
BCRYPT_COST=12

SUPABASE_DB_URL="$(grep -E '^SUPABASE_DB_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "error: SUPABASE_DB_URL is not set in frontend/.env.local." >&2
  echo "       Supabase -> Project Settings -> Database -> Connection string -> URI" >&2
  exit 1
fi

ADMIN_EMAIL="${1:-}"
if [ -z "$ADMIN_EMAIL" ]; then
  read -r -p "Admin email: " ADMIN_EMAIL
fi
case "$ADMIN_EMAIL" in
  *@*.*) ;;
  *) echo "error: '$ADMIN_EMAIL' does not look like an email address." >&2; exit 1 ;;
esac

echo
echo "Choose a password for $ADMIN_EMAIL."
echo "At least $MIN_LEN characters, with upper case, lower case, a digit and a symbol."
echo "It is not echoed, not stored in this shell's history, and not written to disk."
echo
read -r -s -p "Password: " ADMIN_PASSWORD; echo
read -r -s -p "Confirm:  " ADMIN_CONFIRM;  echo
echo

if [ "$ADMIN_PASSWORD" != "$ADMIN_CONFIRM" ]; then
  echo "error: the two passwords do not match." >&2
  exit 1
fi

fail_policy() { echo "error: password must $1." >&2; exit 1; }
[ "${#ADMIN_PASSWORD}" -ge "$MIN_LEN" ] || fail_policy "be at least $MIN_LEN characters"
printf '%s' "$ADMIN_PASSWORD" | grep -q '[A-Z]'      || fail_policy "contain an upper-case letter"
printf '%s' "$ADMIN_PASSWORD" | grep -q '[a-z]'      || fail_policy "contain a lower-case letter"
printf '%s' "$ADMIN_PASSWORD" | grep -q '[0-9]'      || fail_policy "contain a digit"
printf '%s' "$ADMIN_PASSWORD" | grep -q '[^A-Za-z0-9]' || fail_policy "contain a symbol"

export PGCONNECT_TIMEOUT=15

# psql's \set + :'var' handles SQL escaping. Everything goes over stdin so no
# secret ever lands in the process list.
{
  printf "\\set admin_email '%s'\n" "${ADMIN_EMAIL//\'/\'\'}"
  printf "\\set admin_password '%s'\n" "${ADMIN_PASSWORD//\'/\'\'}"
  printf "\\set bcrypt_cost %s\n" "$BCRYPT_COST"
  cat "$ROOT/supabase/create_admin.sql"
} | psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q

status=$?
unset ADMIN_PASSWORD ADMIN_CONFIRM

if [ "$status" -ne 0 ]; then
  echo "Failed. Nothing was changed." >&2
  exit "$status"
fi

echo
echo "Done. Sign in at /login as $ADMIN_EMAIL with the password you just set."
