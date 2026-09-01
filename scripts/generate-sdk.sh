#!/usr/bin/env bash
# Regenerates OpenAPI (.github/fern + docs/) and packages/trueforge-sdk (same steps as CI).
# Requires Docker (Fern --local) and network access for the Fern CLI/image.
set -euo pipefail

cd "$(dirname "$0")/.."

fern_version="$(jq -r .version .github/fern/fern.config.json)"
fern() {
  # Fern only discovers a directory literally named `fern` under the process cwd
  # (https://buildwithfern.com/learn/docs/getting-started/project-structure).
  (cd .github && pnpm dlx "fern-api@${fern_version}" "$@")
}

# Fern --version stamps package.json and baked-in TS literals (SDK_VERSION,
# User-Agent). Pass the version already in package.json so a regen never stomps
# a version changesets (or a human) already set.
current_version="$(node -p "require('./packages/trueforge-sdk/package.json').version")"

pnpm --filter @truefoundry/trueforge-core build
pnpm openapi:write
fern check
# --force skips the overwrite prompt when packages/trueforge-sdk already exists (needed non-interactively / in CI).
fern generate --group ts-sdk --version "$current_version" --local --generate-tests --force --log-level debug
# Fern's generated verify.sh runs `pnpm install` from packages/trueforge-sdk, which now
# resolves to this workspace. CI sets frozen-lockfile, so refresh the root
# lockfile first or that install fails when the generator added/removed deps.
pnpm install --no-frozen-lockfile
(cd packages/trueforge-sdk && bash .fern/verify.sh)
