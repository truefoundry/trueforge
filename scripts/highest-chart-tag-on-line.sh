#!/usr/bin/env bash
# Highest charts/trueforge SemVer on the same line as CURRENT (stdin: one version per line).
#
# Line rules
#   CURRENT X.Y.Z-rc.N  → tags matching X.Y.Z-rc.* only
#   CURRENT X.Y.Z       → tags matching X.Y.* with no prerelease
#
# Examples (CURRENT → highest matching tag)
#   0.2.0-rc.3 + 0.2.0-rc.10,0.3.0-rc.1,0.2.0 → 0.2.0-rc.10
#   0.2.0     + 0.2.1,0.3.0-rc.5,0.2.0-rc.14 → 0.2.1
#
# Workflow then uses max(Chart.yaml, this output) before resolve-chart-version.sh.
set -euo pipefail

CURRENT=${1:?current chart version is required}
SEMVER='^([0-9]+)\.([0-9]+)\.([0-9]+)(-rc\.[0-9]+)?$'

if [[ ! "$CURRENT" =~ $SEMVER ]]; then
  echo "Current chart version '$CURRENT' is not supported semver" >&2
  exit 1
fi

MAJOR=${BASH_REMATCH[1]}
MINOR=${BASH_REMATCH[2]}
PATCH=${BASH_REMATCH[3]}
PRERELEASE=${BASH_REMATCH[4]:-}

if [[ -n "$PRERELEASE" ]]; then
  FILTER="^${MAJOR}\\.${MINOR}\\.${PATCH}-rc\\.[0-9]+$"
else
  FILTER="^${MAJOR}\\.${MINOR}\\.[0-9]+$"
fi

HIGHEST=""
while IFS= read -r tag || [[ -n "$tag" ]]; do
  [[ -z "$tag" || ! "$tag" =~ $FILTER ]] && continue
  if [[ -z "$HIGHEST" ]] ||
    [[ "$(printf '%s\n%s\n' "$HIGHEST" "$tag" | sort -V | tail -1)" == "$tag" ]]; then
    HIGHEST=$tag
  fi
done

if [[ -n "$HIGHEST" ]]; then
  printf '%s\n' "$HIGHEST"
fi
