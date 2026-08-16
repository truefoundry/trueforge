#!/usr/bin/env bash
# Local session-store contract tests: ephemeral Postgres (same defaults as CI)
# then always-on SQLite. Postgres container is removed on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${POSTGRES_IMAGE:-postgres:17-alpine}"
PORT="${POSTGRES_PORT:-55432}"
PGUSER="${POSTGRES_USER:-proto}"
PGPASSWORD="${POSTGRES_PASSWORD:-proto}"
PGDATABASE="${POSTGRES_DB:-proto}"
URL="postgres://${PGUSER}:${PGPASSWORD}@localhost:${PORT}/${PGDATABASE}"
CONTAINER="harness-store-test-pg-$$"
STARTED_CONTAINER=0
WAIT_SECONDS="${POSTGRES_WAIT_SECONDS:-60}"

cleanup() {
  if [[ "$STARTED_CONTAINER" -eq 1 ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required to run store tests locally" >&2
  exit 1
fi

echo "Starting ephemeral Postgres ($IMAGE) on localhost:${PORT}..."
if ! docker run -d --name "$CONTAINER" \
  -e "POSTGRES_USER=${PGUSER}" \
  -e "POSTGRES_PASSWORD=${PGPASSWORD}" \
  -e "POSTGRES_DB=${PGDATABASE}" \
  -p "${PORT}:5432" \
  "$IMAGE" >/dev/null; then
  echo "error: failed to start Postgres on localhost:${PORT} (is the port already in use?)" >&2
  exit 1
fi
STARTED_CONTAINER=1

deadline=$((SECONDS + WAIT_SECONDS))
until docker exec "$CONTAINER" pg_isready -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo "error: Postgres did not become ready within ${WAIT_SECONDS}s" >&2
    docker logs "$CONTAINER" >&2 || true
    exit 1
  fi
  sleep 0.5
done

export SESSION_STORE_TEST_PG_URL="$URL"
echo "Postgres ready. Running Postgres store tests (${URL})..."
pnpm --dir packages/trueforge test:store:postgres "$@"

echo "Running SQLite store tests..."
pnpm --dir packages/trueforge test:store:sqlite "$@"
