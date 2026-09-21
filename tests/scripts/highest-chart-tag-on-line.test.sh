#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

picker=scripts/highest-chart-tag-on-line.sh
failures=0

assert_highest() {
  local expected=$1
  local current=$2
  shift 2
  local actual
  if (($# > 0)); then
    actual=$(printf '%s\n' "$@" | bash "$picker" "$current")
  else
    actual=$(bash "$picker" "$current" </dev/null)
  fi
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL: current=%s expected=%s actual=%s tags=[%s]\n' \
      "$current" "$expected" "${actual:-<empty>}" "${*:-none}" >&2
    failures=$((failures + 1))
  fi
}

# Mid-RC: floor on highest same-core RC.
assert_highest 0.2.0-rc.10 0.2.0-rc.3 \
  0.2.0-rc.5 0.2.0-rc.10 0.3.0-rc.1 0.2.1

# Same-core stable published after this RC Chart.yaml.
assert_highest 0.2.0 0.2.0-rc.3 \
  0.2.0-rc.14 0.2.0 0.3.0-rc.1

# CURRENT already at / past published RCs.
assert_highest 0.2.0-rc.10 0.2.0-rc.10 0.2.0-rc.5 0.2.0-rc.10
assert_highest 0.2.0-rc.9 0.2.0-rc.9 0.2.0-rc.1 0.2.0-rc.2

# rc.9 < rc.10 under sort -V.
assert_highest 0.2.0-rc.10 0.2.0-rc.1 0.2.0-rc.10 0.2.0-rc.9

# Stable hotfix line: higher X.Y patch; ignore newer major/RC leftovers.
assert_highest 0.2.1 0.2.0 \
  0.2.0 0.2.1 0.3.0-rc.5 0.2.0-rc.14
assert_highest 0.2.10 0.2.0 0.2.9 0.2.10 0.2.2
assert_highest 0.2.0 0.2.0 0.2.0-rc.14 0.3.0

# No matching tags → CURRENT.
assert_highest 0.2.0-rc.3 0.2.0-rc.3
assert_highest 0.2.0 0.2.0

if ((failures > 0)); then
  exit 1
fi

echo "Highest chart tag on line tests passed"
