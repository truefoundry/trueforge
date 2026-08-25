#!/usr/bin/env bash
# Create/start a minimal Lima VM and run `pnpm smoke:local-sandbox` for Linux SRT coverage.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# packages/trueforge/scripts/local-sandbox → workspace root (pnpm install --filter).
ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
INSTANCE="${LIMA_INSTANCE:-local-sandbox-poc}"
YAML_TEMPLATE="${SCRIPT_DIR}/lima.yaml"

if ! command -v limactl >/dev/null 2>&1; then
  echo "limactl not found; install Lima first (e.g. brew install lima)" >&2
  exit 1
fi

if ! limactl list -f '{{.Name}}' 2>/dev/null | grep -qx "${INSTANCE}"; then
  echo "creating Lima instance ${INSTANCE} (minimal: 1 CPU / 2GiB)..."
  YAML="$(mktemp -t local-sandbox-lima.XXXXXX.yaml)"
  trap 'rm -f "${YAML}"' EXIT
  # Lima requires absolute mount locations.
  sed "s|__LOCAL_SANDBOX_ROOT__|${ROOT}|g" "${YAML_TEMPLATE}" >"${YAML}"
  limactl create --name="${INSTANCE}" --yes "${YAML}"
fi

status="$(limactl list -f '{{.Name}} {{.Status}}' | awk -v n="${INSTANCE}" '$1==n { print $2; exit }')"
if [[ "${status}" != "Running" ]]; then
  echo "starting Lima instance ${INSTANCE}..."
  limactl start "${INSTANCE}"
fi

echo "running Linux smoke inside ${INSTANCE}..."
# Mount mirrors the host absolute path. Guest deps/sysctl come from lima provision.
limactl shell "${INSTANCE}" -- bash -lc "
  set -euo pipefail
  cd $(printf '%q' "${ROOT}")
  CI=true pnpm install --no-frozen-lockfile
  pnpm --filter @truefoundry/trueforge smoke:local-sandbox
"
