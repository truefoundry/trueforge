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

assert_rejects() {
  local current=$1
  if printf '' | bash "$picker" "$current" >/dev/null 2>&1; then
    printf 'FAIL: expected reject for current=%s\n' "$current" >&2
    failures=$((failures + 1))
  fi
}

# --- RC line: same X.Y.Z-rc.* ---

# Lagging Chart.yaml; floor on highest RC of that core.
assert_highest 0.2.0-rc.10 0.2.0-rc.3 \
  0.2.0-rc.5 0.2.0-rc.10 0.3.0-rc.1 0.2.0 0.2.1

# Chart.yaml already at the highest published RC on the line.
assert_highest 0.2.0-rc.10 0.2.0-rc.10 \
  0.2.0-rc.5 0.2.0-rc.10

# Only lower RCs published; return that max (workflow maxes with Chart.yaml).
assert_highest 0.2.0-rc.2 0.2.0-rc.9 \
  0.2.0-rc.1 0.2.0-rc.2

# sort -V: rc.9 < rc.10 even if listed first.
assert_highest 0.2.0-rc.10 0.2.0-rc.1 \
  0.2.0-rc.10 0.2.0-rc.9 0.2.0-rc.2

# Duplicate tags are fine.
assert_highest 0.2.0-rc.4 0.2.0-rc.1 \
  0.2.0-rc.4 0.2.0-rc.4 0.2.0-rc.3

# Blank stdin lines ignored.
assert_highest 0.2.0-rc.3 0.2.0-rc.1 \
  '' 0.2.0-rc.3 ''

# Other patch-core RCs (0.2.1-rc.*) are a different line.
assert_highest 0.2.0-rc.4 0.2.0-rc.1 \
  0.2.1-rc.9 0.2.0-rc.4

# Other minor/major RCs ignored.
assert_highest 0.2.0-rc.1 0.2.0-rc.1 \
  0.2.0-rc.1 0.3.0-rc.99 0.1.0-rc.50

# Stable tags on the same X.Y do not join an RC line.
assert_highest "" 0.2.0-rc.1 \
  0.2.0 0.2.1 0.1.9-rc.0 0.3.0-rc.1

# No tags at all.
assert_highest "" 0.2.0-rc.3

# Single matching tag equals CURRENT core.
assert_highest 0.2.0-rc.0 0.2.0-rc.0 \
  0.2.0-rc.0

# --- Stable line: X.Y.* without prerelease ---

# Patch floor within X.Y; ignore newer major/RC and older minor.
assert_highest 0.2.1 0.2.0 \
  0.2.0 0.2.1 0.3.0-rc.5 0.2.0-rc.14 0.1.9

# Higher patch already shipped.
assert_highest 0.2.5 0.2.0 \
  0.2.0 0.2.3 0.2.5

# CURRENT ahead of tags; return tag max only.
assert_highest 0.2.1 0.2.9 \
  0.2.0 0.2.1

# Newer major stable ignored.
assert_highest "" 0.2.0 \
  0.3.0 0.3.1

# Newer major RC ignored.
assert_highest "" 0.2.0 \
  0.3.0-rc.1 0.3.0-rc.5

# Same-minor RCs ignored (post-stable leftover tags).
assert_highest "" 0.2.0 \
  0.2.0-rc.14 0.2.1-rc.0

# Older minor stable ignored.
assert_highest 0.2.0 0.2.0 \
  0.1.9 0.2.0

# Empty tag list.
assert_highest "" 0.2.0

# sort -V across multi-digit patches.
assert_highest 0.2.10 0.2.0 \
  0.2.9 0.2.10 0.2.2

# Mixed noise; only stable X.Y survive.
assert_highest 0.2.2 0.2.1 \
  0.2.0-rc.1 0.2.2 0.3.0 0.2.1-rc.3 0.1.99 0.2.1

# --- Reject unsupported CURRENT ---

assert_rejects 'not-a-version'
assert_rejects '0.2.0-beta.1'
assert_rejects '0.2'

if ((failures > 0)); then
  exit 1
fi

echo "Highest chart tag on line tests passed"
