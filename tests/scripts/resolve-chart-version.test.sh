#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

resolver=scripts/resolve-chart-version.sh
failures=0

assert_version() {
  local expected=$1
  local current=$2
  local app_version=$3
  local pr_version=${4:-}
  local actual

  actual=$(bash "$resolver" "$current" "$app_version" "$pr_version")
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL: current=%s app=%s pr=%s expected=%s actual=%s\n' \
      "$current" "$app_version" "${pr_version:-none}" "$expected" "$actual" >&2
    failures=$((failures + 1))
  fi
}

# Same major.minor as the app: stable charts continue with patch bumps.
assert_version 0.1.6 0.1.5 0.1.5
assert_version 0.1.7 0.1.6 0.1.6

# Entering prerelease mode on the same line starts the chart RC counter at zero.
assert_version 0.1.6-rc.0 0.1.5 0.1.5-rc.2

# Merged chart RCs and RCs in the open chart PR both advance linearly.
assert_version 0.1.6-rc.1 0.1.6-rc.0 0.1.5-rc.99
assert_version 0.1.6-rc.4 0.1.6-rc.3 0.1.5-rc.0
assert_version 0.1.6-rc.1 0.1.5 0.1.5-rc.7 0.1.6-rc.0
assert_version 0.1.6-rc.5 0.1.6-rc.3 0.1.5-rc.7 0.1.6-rc.4

# Leaving prerelease mode stabilizes the existing core before patch bumps resume.
assert_version 0.1.6 0.1.6-rc.4 0.1.6
assert_version 0.1.6 0.1.5 0.1.6 0.1.6-rc.4

# Chart major.minor follows the app (package / docker prefix).
assert_version 0.3.0-rc.0 0.2.3-rc.0 0.3.0-rc.0
assert_version 0.3.0 0.2.5 0.3.0
assert_version 0.4.0-rc.0 0.3.1 0.4.0-rc.1

# A reviewer patch bump on the open PR is kept when it stays on the app line.
assert_version 0.3.1-rc.0 0.3.0 0.3.0-rc.1 0.3.1
assert_version 0.3.0-rc.5 0.3.0-rc.3 0.3.0-rc.0 0.3.0-rc.4

# A PR version on a different minor than the app is ignored.
assert_version 0.3.0-rc.0 0.2.3-rc.0 0.3.0-rc.0 0.4.0
assert_version 0.1.6-rc.0 0.1.5 0.1.5-rc.3 0.2.0

if ((failures > 0)); then
  exit 1
fi

echo "Chart version resolution tests passed"
