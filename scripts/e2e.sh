#!/usr/bin/env bash
# Local E2E contract: ephemeral Compose stack (isolated from host-dev and smoke),
# then the package CLI. Stack is always removed on exit (including failures).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.e2e.yml)
ENV_FILE="$ROOT/packages/trueforge/e2e/.env"
ENV_EXAMPLE="$ROOT/packages/trueforge/e2e/.env.example"
E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:8792}"
STARTED_STACK=0

cleanup() {
  if [[ "$STARTED_STACK" -eq 1 ]]; then
    "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required to run E2E tests" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: missing $ENV_FILE" >&2
  echo "Copy $ENV_EXAMPLE to $ENV_FILE and fill in values." >&2
  exit 1
fi

echo "Starting E2E stack (API ${E2E_BASE_URL})..."
if ! "${COMPOSE[@]}" up --build --wait; then
  echo "error: failed to start docker-compose.e2e.yml (server unhealthy, or ports 8792/5434/6381 in use)" >&2
  "${COMPOSE[@]}" logs --tail=200 server >&2 || true
  STARTED_STACK=1
  exit 1
fi
STARTED_STACK=1

node -e "
Promise.all([
  fetch('${E2E_BASE_URL}/healthz'),
  fetch('${E2E_BASE_URL}/'),
]).then(async ([health, ui]) => {
  if (!health.ok) throw new Error('healthz returned ' + health.status);
  const html = await ui.text();
  if (!ui.ok || !html.includes('id=\"root\"')) throw new Error('UI did not return its app shell');
  console.log('healthz and UI OK');
});
"

echo "Running E2E cases..."
pnpm --filter @truefoundry/trueforge e2e -- "$@"
