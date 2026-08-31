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
CURRENT_PRERELEASE=${BASH_REMATCH[4]:-}
SELECTED_MAJOR=$MAJOR
SELECTED_MINOR=$MINOR
SELECTED_PATCH=$PATCH

# A stable chart starts the next patch. A prerelease chart is already on its
# target core, so subsequent RCs and the stable release keep that core.
if [[ -z "$CURRENT_PRERELEASE" ]]; then
  SELECTED_PATCH=$((PATCH + 1))
fi

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

# The app version only selects stable or prerelease mode. Chart RC counters are
# derived from chart versions and advance independently from the app's suffix.
SELECTED_PRERELEASE=""
if [[ -n "$APP_PRERELEASE" ]]; then
  RC_COUNTER='^-rc\.([0-9]+)$'
  HIGHEST_RC=-1

  if ((MAJOR == SELECTED_MAJOR && MINOR == SELECTED_MINOR && PATCH == SELECTED_PATCH)) &&
    [[ "$CURRENT_PRERELEASE" =~ $RC_COUNTER ]]; then
    HIGHEST_RC=${BASH_REMATCH[1]}
  fi

  if [[ "$PR_CORE_SELECTED" == true && "$PR_PRERELEASE" =~ $RC_COUNTER ]]; then
    PR_COUNTER=${BASH_REMATCH[1]}
    if ((PR_COUNTER > HIGHEST_RC)); then
      HIGHEST_RC=$PR_COUNTER
    fi
  fi

  SELECTED_PRERELEASE="-rc.$((HIGHEST_RC + 1))"
fi

VERSION="${SELECTED_MAJOR}.${SELECTED_MINOR}.${SELECTED_PATCH}${SELECTED_PRERELEASE}"
printf '%s\n' "$VERSION"
