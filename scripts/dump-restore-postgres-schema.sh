#!/usr/bin/env bash
# Dump a Postgres schema from a remote DB and restore it onto local.
#
# Wipes the target schema on local first (DROP SCHEMA … CASCADE), then restores
# schema objects + data from remote. Requires pg_dump and psql on PATH.
#
# Usage:
#   REMOTE_DATABASE_URL='postgres://…' \
#   LOCAL_DATABASE_URL='postgres://postgres:postgres@localhost:5432/trueforge' \
#   ./scripts/dump-restore-postgres-schema.sh
#
# Options:
#   --remote-url URL   Remote Postgres connection string (or REMOTE_DATABASE_URL)
#   --local-url URL    Local Postgres connection string (or LOCAL_DATABASE_URL)
#   --schema NAME      Schema to copy (default: trueforge, or POSTGRES_SCHEMA)
#   --dump-file PATH   Keep the dump at PATH instead of a temp file
#   --dump-only        Only dump remote; do not restore
#   --restore-only     Only restore from --dump-file (skip remote dump)
#   -y, --yes          Skip the local destructive-confirm prompt
#   -h, --help         Show help
#
# Notes:
#   - libpq does not understand sslmode=no-verify (Node/pg). The script maps it
#     to sslmode=require for pg_dump/psql.
#   - Extensions installed outside this schema are not copied.

set -euo pipefail

REMOTE_URL="${REMOTE_DATABASE_URL:-}"
LOCAL_URL="${LOCAL_DATABASE_URL:-}"
SCHEMA="${POSTGRES_SCHEMA:-trueforge}"
DUMP_FILE=""
DUMP_ONLY=0
RESTORE_ONLY=0
ASSUME_YES=0
KEEP_DUMP=0

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \?//'
}

redact_url() {
  # postgres://user:pass@host → postgres://user:***@host
  printf '%s\n' "$1" | sed -E 's#(://[^:/?#]+:)[^@/#]+@#\1***@#'
}

normalize_libpq_url() {
  # Map Node-only sslmode=no-verify → require for libpq clients.
  printf '%s\n' "$1" | sed -E 's/([?&]sslmode=)no-verify/\1require/g'
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

human_bytes() {
  local n="${1:-0}"
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec --suffix=B "$n" 2>/dev/null && return
  fi
  awk -v n="$n" 'BEGIN {
    split("B KiB MiB GiB TiB", u, " ")
    i = 1
    while (n >= 1024 && i < 5) { n /= 1024; i++ }
    if (i == 1) printf "%d %s\n", n, u[i]
    else printf "%.1f %s\n", n, u[i]
  }'
}

format_elapsed() {
  local s="${1:-0}"
  printf '%d:%02d' "$((s / 60))" "$((s % 60))"
}

clear_progress_line() {
  printf '\r\033[K' >&2
}

# Live spinner while PID runs; optionally show growing dump file size.
watch_pid_progress() {
  local pid="$1"
  local label="$2"
  local file="${3:-}"
  local start=$SECONDS
  local frames='|/-\'
  local i=0
  local status=0

  while kill -0 "$pid" 2>/dev/null; do
    local elapsed=$((SECONDS - start))
    local msg="[${label}] $(format_elapsed "$elapsed") elapsed"
    if [[ -n "$file" && -e "$file" ]]; then
      local bytes
      bytes="$(wc -c <"$file" | tr -d '[:space:]')"
      msg+=" · $(human_bytes "$bytes") written"
    fi
    printf '\r%s %s' "${frames:i++%${#frames}:1}" "$msg" >&2
    sleep 0.25
  done

  wait "$pid" || status=$?
  clear_progress_line
  return "$status"
}

# Restore progress: prefer pv (byte bar); else count CREATE TABLE / COPY stmts.
restore_with_progress() {
  local dump_file="$1"
  local local_url="$2"
  local dump_bytes
  dump_bytes="$(wc -c <"$dump_file" | tr -d '[:space:]')"
  local start=$SECONDS
  local status=0

  if command -v pv >/dev/null 2>&1; then
    # Bytes through the pipe ≈ how far restore SQL has been fed to psql.
    if ! pv -pterb -s "$dump_bytes" "$dump_file" \
      | psql "$local_url" --set ON_ERROR_STOP=1 >/dev/null; then
      status=$?
    fi
  else
    local total
    total="$(grep -cE '^(CREATE TABLE |COPY )' "$dump_file" || true)"
    if [[ -z "$total" || "$total" -eq 0 ]]; then
      total=1
    fi

    echo "(tip: brew install pv  # byte progress bar during restore)" >&2

    # Stream SQL to psql; tick the status line on each major object header.
    # Large COPY payloads still take wall time after their header is reported.
    if ! awk -v total="$total" '
      /^(CREATE TABLE |COPY )/ {
        n++
        pct = int(n * 100 / total)
        obj = $0
        if (length(obj) > 72) obj = substr(obj, 1, 72) "…"
        printf "\r[restore] %3d%% (%d/%d objects) · %s\033[K", pct, n, total, obj > "/dev/stderr"
      }
      { print }
      END {
        printf "\r\033[K" > "/dev/stderr"
      }
    ' "$dump_file" | psql "$local_url" --set ON_ERROR_STOP=1 >/dev/null; then
      status=$?
    fi
  fi

  clear_progress_line
  local elapsed=$((SECONDS - start))
  echo "Restore finished in $(format_elapsed "$elapsed") ($(human_bytes "$dump_bytes"))."
  return "$status"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote-url)
      REMOTE_URL="${2:-}"
      shift 2
      ;;
    --local-url)
      LOCAL_URL="${2:-}"
      shift 2
      ;;
    --schema)
      SCHEMA="${2:-}"
      shift 2
      ;;
    --dump-file)
      DUMP_FILE="${2:-}"
      KEEP_DUMP=1
      shift 2
      ;;
    --dump-only)
      DUMP_ONLY=1
      shift
      ;;
    --restore-only)
      RESTORE_ONLY=1
      shift
      ;;
    -y|--yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$DUMP_ONLY" -eq 1 && "$RESTORE_ONLY" -eq 1 ]]; then
  echo "error: --dump-only and --restore-only are mutually exclusive" >&2
  exit 1
fi

if [[ "$RESTORE_ONLY" -eq 1 && -z "$DUMP_FILE" ]]; then
  echo "error: --restore-only requires --dump-file" >&2
  exit 1
fi

if [[ "$RESTORE_ONLY" -eq 0 && -z "$REMOTE_URL" ]]; then
  echo "error: set REMOTE_DATABASE_URL or pass --remote-url" >&2
  exit 1
fi

if [[ "$DUMP_ONLY" -eq 0 && -z "$LOCAL_URL" ]]; then
  echo "error: set LOCAL_DATABASE_URL or pass --local-url" >&2
  exit 1
fi

if [[ -z "$SCHEMA" ]]; then
  echo "error: schema name must not be empty" >&2
  exit 1
fi

# Reject identifiers that would break the quoted SQL we emit.
if [[ ! "$SCHEMA" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "error: schema must be a simple SQL identifier (got: $SCHEMA)" >&2
  exit 1
fi

require_cmd pg_dump
require_cmd psql

REMOTE_URL_PG="$(normalize_libpq_url "${REMOTE_URL:-}")"
LOCAL_URL_PG="$(normalize_libpq_url "${LOCAL_URL:-}")"

dump_pid=""
cleanup() {
  if [[ -n "${dump_pid:-}" ]] && kill -0 "$dump_pid" 2>/dev/null; then
    kill "$dump_pid" 2>/dev/null || true
    wait "$dump_pid" 2>/dev/null || true
  fi
  if [[ "$KEEP_DUMP" -eq 0 && -n "${DUMP_FILE:-}" && -f "$DUMP_FILE" ]]; then
    rm -f "$DUMP_FILE"
  fi
}
trap cleanup EXIT INT TERM

if [[ -z "$DUMP_FILE" ]]; then
  DUMP_FILE="$(mktemp "${TMPDIR:-/tmp}/trueforge-${SCHEMA}-XXXXXX.sql")"
  KEEP_DUMP=0
else
  mkdir -p "$(dirname "$DUMP_FILE")"
fi

TOTAL_STEPS=4
if [[ "$RESTORE_ONLY" -eq 1 ]]; then
  TOTAL_STEPS=3
elif [[ "$DUMP_ONLY" -eq 1 ]]; then
  TOTAL_STEPS=1
fi
STEP=0

next_step() {
  STEP=$((STEP + 1))
  echo ""
  echo "==> [${STEP}/${TOTAL_STEPS}] $1"
}

if [[ "$RESTORE_ONLY" -eq 0 ]]; then
  next_step "Dump remote schema '${SCHEMA}' from $(redact_url "$REMOTE_URL_PG")"
  dump_start=$SECONDS
  # Plain SQL: includes CREATE SCHEMA, tables, indexes, constraints, sequences,
  # functions, triggers, views, grants in-schema, and all data.
  pg_dump "$REMOTE_URL_PG" \
    --schema="$SCHEMA" \
    --no-owner \
    --no-acl \
    --format=plain \
    --file="$DUMP_FILE" &
  dump_pid=$!
  if ! watch_pid_progress "$dump_pid" "dump" "$DUMP_FILE"; then
    echo "error: pg_dump failed" >&2
    exit 1
  fi
  dump_bytes="$(wc -c <"$DUMP_FILE" | tr -d '[:space:]')"
  echo "Wrote dump: $DUMP_FILE ($(human_bytes "$dump_bytes") in $(format_elapsed "$((SECONDS - dump_start))"))"
fi

if [[ "$DUMP_ONLY" -eq 1 ]]; then
  KEEP_DUMP=1
  echo "Dump-only mode; skipping restore."
  exit 0
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "error: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

echo ""
echo "About to wipe and restore schema '${SCHEMA}' on local $(redact_url "$LOCAL_URL_PG")"
if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "This runs DROP SCHEMA \"${SCHEMA}\" CASCADE on local. Continue? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *)
      echo "Aborted."
      exit 1
      ;;
  esac
fi

next_step "Drop local schema \"${SCHEMA}\" CASCADE"
psql "$LOCAL_URL_PG" \
  --set ON_ERROR_STOP=1 \
  --command "DROP SCHEMA IF EXISTS \"${SCHEMA}\" CASCADE;"
echo "Local schema dropped."

next_step "Restore dump into local"
if ! restore_with_progress "$DUMP_FILE" "$LOCAL_URL_PG"; then
  echo "error: restore failed" >&2
  exit 1
fi

next_step "Verify local schema \"${SCHEMA}\""
psql "$LOCAL_URL_PG" \
  --set ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --command "SELECT COUNT(*)::text || ' relations in schema ${SCHEMA}'
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = '${SCHEMA}'
               AND c.relkind IN ('r','p','v','m','S','f');"

echo ""
echo "Done."
