#!/usr/bin/env bash
# Highest charts/trueforge SemVer on the same line as CURRENT (stdin: one version
# per line). Always prints at least CURRENT.
#
#   CURRENT X.Y.Z-rc.N  → X.Y.Z-rc.* ; same-core stable X.Y.Z wins if present
#     e.g. 0.2.0-rc.3 + 0.2.0-rc.10,0.3.0-rc.1 → 0.2.0-rc.10
#          0.2.0-rc.3 + 0.2.0-rc.14,0.2.0 → 0.2.0
#   CURRENT X.Y.Z       → X.Y.* with no prerelease
#     e.g. 0.2.0 + 0.2.1,0.3.0-rc.5 → 0.2.1
set -euo pipefail

CURRENT=${1:?current chart version is required}
SEMVER='^([0-9]+)\.([0-9]+)\.([0-9]+)(-rc\.[0-9]+)?$'
[[ "$CURRENT" =~ $SEMVER ]]

MAJOR=${BASH_REMATCH[1]}
MINOR=${BASH_REMATCH[2]}
PATCH=${BASH_REMATCH[3]}
PRERELEASE=${BASH_REMATCH[4]:-}
STABLE="${MAJOR}.${MINOR}.${PATCH}"

if [[ -n "$PRERELEASE" ]]; then
  FILTER="^${MAJOR}\\.${MINOR}\\.${PATCH}-rc\\.[0-9]+$"
else
  FILTER="^${MAJOR}\\.${MINOR}\\.[0-9]+$"
fi

HIGHEST=$CURRENT
while IFS= read -r tag || [[ -n "$tag" ]]; do
  # sort -V ranks X.Y.Z-rc.* above X.Y.Z; same-core stable closes the RC line.
  if [[ -n "$PRERELEASE" && "$tag" == "$STABLE" ]]; then
    printf '%s\n' "$STABLE"
    exit 0
  fi
  [[ -z "$tag" || ! "$tag" =~ $FILTER ]] && continue
  HIGHEST=$(printf '%s\n%s\n' "$HIGHEST" "$tag" | sort -V | tail -1)
done

printf '%s\n' "$HIGHEST"
