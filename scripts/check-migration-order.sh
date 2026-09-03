#!/usr/bin/env bash

set -euo pipefail

main_ref="${MIGRATION_BASE_REF:-origin/main}"
migration_dirs=(
  "packages/trueforge/src/db/postgres/migrations"
  "packages/trueforge/src/db/sqlite/migrations"
)

latest_main_migration="$(
  git ls-tree -r --name-only "$main_ref" -- "${migration_dirs[@]}" \
    | awk -F/ '{ print $NF }' \
    | sort \
    | tail -n 1
)"

added_migrations="$(
  git diff --name-only --diff-filter=A "$main_ref...HEAD" -- "${migration_dirs[@]}" \
    | awk -F/ '{ print $NF }' \
    | sort
)"

if [ -z "$added_migrations" ]; then
  echo "No new migrations added relative to $main_ref"
  exit 0
fi

invalid_migrations="$(
  while IFS= read -r migration; do
    [ -n "$migration" ] || continue
    if [[ "$migration" < "$latest_main_migration" || "$migration" == "$latest_main_migration" ]]; then
      echo "$migration"
    fi
  done <<< "$added_migrations"
)"

if [ -z "$invalid_migrations" ]; then
  echo "All added migrations sort after $main_ref ($latest_main_migration)"
  exit 0
fi

echo "Latest migration on $main_ref: $latest_main_migration" >&2
echo "Added migrations must sort strictly after it:" >&2
while IFS= read -r migration; do
  [ -n "$migration" ] || continue
  echo "- $migration" >&2
done <<< "$invalid_migrations"
exit 1
