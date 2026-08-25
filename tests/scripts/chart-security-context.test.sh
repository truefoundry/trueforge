#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

manifest=$(pnpm --silent chart:template)
deployment=$(
  printf '%s\n' "$manifest" | awk '
    $0 == "# Source: trueforge/templates/deployment.yaml" {
      capture = 1
      doc = ""
      next
    }
    capture && /^---$/ {
      printf "%s", doc
      found = 1
      capture = 0
      exit
    }
    capture {
      doc = doc $0 "\n"
    }
    END {
      if (capture && !found) {
        printf "%s", doc
      }
    }
  '
)

if [[ -z "$deployment" ]]; then
  echo "FAIL: trueforge Deployment was not rendered" >&2
  exit 1
fi

failures=0

assert_contains() {
  local needle=$1
  if [[ "$deployment" != *"$needle"* ]]; then
    printf 'FAIL: rendered Deployment missing %s\n' "$needle" >&2
    failures=$((failures + 1))
  fi
}

assert_contains "kind: Deployment"
assert_contains "  name: trueforge"
assert_contains "        fsGroup: 10001"
assert_contains "        runAsGroup: 10001"
assert_contains "        runAsNonRoot: true"
assert_contains "        runAsUser: 10001"
assert_contains "        seccompProfile:"
assert_contains "          type: RuntimeDefault"
assert_contains "            allowPrivilegeEscalation: false"
assert_contains "            readOnlyRootFilesystem: true"
assert_contains "            capabilities:"
assert_contains "              drop:"
assert_contains "              - ALL"
assert_contains "          volumeMounts:"
assert_contains "            - name: tmp"
assert_contains "              mountPath: /tmp"
assert_contains "      volumes:"
assert_contains "        - name: tmp"
assert_contains "          emptyDir: {}"

if ((failures > 0)); then
  exit 1
fi

echo "Chart security context tests passed"
