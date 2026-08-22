#!/usr/bin/env bash
set -euo pipefail

CURRENT=${1:?current chart version is required}
APP_VERSION=${2:?app version is required}
PR_VERSION=${3:-}

SEMVER='^([0-9]+)\.([0-9]+)\.([0-9]+)(-[0-9A-Za-z.-]+)?$'

if [[ ! "$CURRENT" =~ $SEMVER ]]; then
  echo "Current chart version '$CURRENT' is not semver" >&2
  exit 1
fi

MAJOR=${BASH_REMATCH[1]}
MINOR=${BASH_REMATCH[2]}
PATCH=${BASH_REMATCH[3]}
SELECTED_MAJOR=$MAJOR
SELECTED_MINOR=$MINOR
SELECTED_PATCH=$((PATCH + 1))

if [[ ! "$APP_VERSION" =~ $SEMVER ]]; then
  echo "App version '$APP_VERSION' is not semver" >&2
  exit 1
fi

APP_PRERELEASE=${BASH_REMATCH[4]:-}
PR_PRERELEASE=""
PR_CORE_SELECTED=false

if [[ -n "$PR_VERSION" && "$PR_VERSION" =~ $SEMVER ]]; then
  PR_MAJOR=${BASH_REMATCH[1]}
  PR_MINOR=${BASH_REMATCH[2]}
  PR_PATCH=${BASH_REMATCH[3]}
  PR_PRERELEASE=${BASH_REMATCH[4]:-}

  if ((PR_MAJOR > SELECTED_MAJOR ||
    (PR_MAJOR == SELECTED_MAJOR && PR_MINOR > SELECTED_MINOR) ||
    (PR_MAJOR == SELECTED_MAJOR && PR_MINOR == SELECTED_MINOR && PR_PATCH > SELECTED_PATCH))); then
    SELECTED_MAJOR=$PR_MAJOR
    SELECTED_MINOR=$PR_MINOR
    SELECTED_PATCH=$PR_PATCH
    PR_CORE_SELECTED=true
  elif ((PR_MAJOR == SELECTED_MAJOR && PR_MINOR == SELECTED_MINOR && PR_PATCH == SELECTED_PATCH)); then
    PR_CORE_SELECTED=true
  fi
fi

# Chart and app versions have independent numeric cores but share the release lane.
SELECTED_PRERELEASE=$APP_PRERELEASE
PRERELEASE_COUNTER='^-([0-9A-Za-z-]+)\.([0-9]+)$'
if [[ "$PR_CORE_SELECTED" == true && -n "$APP_PRERELEASE" && "$APP_PRERELEASE" =~ $PRERELEASE_COUNTER ]]; then
  APP_TAG=${BASH_REMATCH[1]}
  APP_COUNTER=${BASH_REMATCH[2]}
  if [[ "$PR_PRERELEASE" =~ $PRERELEASE_COUNTER ]]; then
    PR_TAG=${BASH_REMATCH[1]}
    PR_COUNTER=${BASH_REMATCH[2]}
    if [[ "$PR_TAG" == "$APP_TAG" ]] && ((PR_COUNTER > APP_COUNTER)); then
      SELECTED_PRERELEASE=$PR_PRERELEASE
    fi
  fi
fi

VERSION="${SELECTED_MAJOR}.${SELECTED_MINOR}.${SELECTED_PATCH}${SELECTED_PRERELEASE}"
printf '%s\n' "$VERSION"
