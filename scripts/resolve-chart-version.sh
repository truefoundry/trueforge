#!/usr/bin/env bash
set -euo pipefail

CURRENT=${1:?current chart version is required}
APP_VERSION=${2:?app version is required}
PR_VERSION=${3:-}

SEMVER='^([0-9]+)\.([0-9]+)\.([0-9]+)(-[0-9A-Za-z.-]+)?$'

parse() {
  local v=$1
  if [[ ! "$v" =~ $SEMVER ]]; then
    return 1
  fi
  _major=${BASH_REMATCH[1]}
  _minor=${BASH_REMATCH[2]}
  _patch=${BASH_REMATCH[3]}
  _pre=${BASH_REMATCH[4]:-}
}

if ! parse "$CURRENT"; then
  echo "Current chart version '$CURRENT' is not semver" >&2
  exit 1
fi
CUR_MAJOR=$_major
CUR_MINOR=$_minor
CUR_PATCH=$_patch
CUR_PRE=$_pre

if ! parse "$APP_VERSION"; then
  echo "App version '$APP_VERSION' is not semver" >&2
  exit 1
fi
APP_MAJOR=$_major
APP_MINOR=$_minor
APP_PRE=$_pre

# Chart major.minor follows the app package (and thus the docker tag prefix).
SELECTED_MAJOR=$APP_MAJOR
SELECTED_MINOR=$APP_MINOR

if ((CUR_MAJOR == APP_MAJOR && CUR_MINOR == APP_MINOR)); then
  # Same line: a stable chart starts the next patch. A prerelease chart is
  # already on its target core, so later RCs and the stable release keep it.
  if [[ -z "$CUR_PRE" ]]; then
    SELECTED_PATCH=$((CUR_PATCH + 1))
  else
    SELECTED_PATCH=$CUR_PATCH
  fi
else
  SELECTED_PATCH=0
fi

PR_CORE_SELECTED=false
PR_PRE=""
if [[ -n "$PR_VERSION" ]] && parse "$PR_VERSION"; then
  PR_MAJOR=$_major
  PR_MINOR=$_minor
  PR_PATCH=$_patch
  PR_PRE=$_pre
  # A reviewer bump on the open PR is kept only when it stays on the app line.
  if ((PR_MAJOR == APP_MAJOR && PR_MINOR == APP_MINOR)); then
    if ((PR_PATCH > SELECTED_PATCH)); then
      SELECTED_PATCH=$PR_PATCH
      PR_CORE_SELECTED=true
    elif ((PR_PATCH == SELECTED_PATCH)); then
      PR_CORE_SELECTED=true
    fi
  fi
fi

SELECTED_PRE=""
if [[ -n "$APP_PRE" ]]; then
  RC_COUNTER='^-rc\.([0-9]+)$'
  HIGHEST_RC=-1

  if ((CUR_MAJOR == SELECTED_MAJOR && CUR_MINOR == SELECTED_MINOR && CUR_PATCH == SELECTED_PATCH)) &&
    [[ "$CUR_PRE" =~ $RC_COUNTER ]]; then
    HIGHEST_RC=${BASH_REMATCH[1]}
  fi

  if [[ "$PR_CORE_SELECTED" == true && "$PR_PRE" =~ $RC_COUNTER ]]; then
    PR_COUNTER=${BASH_REMATCH[1]}
    if ((PR_COUNTER > HIGHEST_RC)); then
      HIGHEST_RC=$PR_COUNTER
    fi
  fi

  SELECTED_PRE="-rc.$((HIGHEST_RC + 1))"
fi

printf '%s\n' "${SELECTED_MAJOR}.${SELECTED_MINOR}.${SELECTED_PATCH}${SELECTED_PRE}"
