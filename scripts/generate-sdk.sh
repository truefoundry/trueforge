#!/usr/bin/env bash
# Regenerates fern/openapi/openapi.json and packages/sdk (same steps as CI).
# Requires Docker (Fern --local) and network access for the Fern CLI/image.
set -euo pipefail

cd "$(dirname "$0")/.."

fern_version="$(jq -r .version fern/fern.config.json)"
fern() {
  pnpm dlx "fern-api@${fern_version}" "$@"
}

pnpm --filter @truefoundry/utils-core build
pnpm openapi:write
fern check
# --force skips the overwrite prompt when packages/sdk already exists (needed non-interactively / in CI).
fern generate --group ts-sdk --version 0.0.0 --local --generate-tests --force --log-level debug
(cd packages/sdk && bash .fern/verify.sh)
