#!/usr/bin/env bash
# Regenerates OpenAPI (.github/fern + docs/), packages/trueforge-sdk, and
# python/trueforge_sdk (same steps as CI).
# Requires Docker (Fern --local) and network access for the Fern CLI/image.
set -euo pipefail

cd "$(dirname "$0")/.."

fern_version="$(jq -r .version .github/fern/fern.config.json)"
fern() {
  # Fern only discovers a directory literally named `fern` under the process cwd
  # (https://buildwithfern.com/learn/docs/getting-started/project-structure).
  (cd .github && pnpm dlx "fern-api@${fern_version}" "$@")
}

# Fern --version stamps package metadata and baked-in SDK version / User-Agent.
# Pass the version already in each package's metadata so a regen never stomps a
# version a human (or Changesets, for TS) already set.
ts_version="$(node -p "require('./packages/trueforge-sdk/package.json').version")"
# Python has its own line (not Changesets/npm). Prefer pyproject.toml when present.
py_version="0.1.0-rc.1"
if [[ -f python/trueforge_sdk/pyproject.toml ]]; then
  py_version="$(node -p 'require("fs").readFileSync("python/trueforge_sdk/pyproject.toml","utf8").match(/^version\s*=\s*"([^"]+)"/m)[1]')"
fi

pnpm --filter @truefoundry/trueforge-core build
pnpm openapi:write
fern check
# --force skips the overwrite prompt when the SDK dirs already exist (needed non-interactively / in CI).
fern generate --group ts-sdk --version "$ts_version" --local --generate-tests --force --log-level debug
fern generate --group python-sdk --version "$py_version" --local --generate-tests --force --log-level debug
test -f python/trueforge_sdk/src/trueforge_sdk/client.py


# local-file-system has no output.package-name; Fern stamps the import name into
# dist metadata. Explicit file list + dist-prefix regex (not tree-wide): imports /
# package dir stay trueforge_sdk. Prefer Cursor/Bugbot to catch new Fern stamps
# that still say trueforge_sdk where the PyPI name should be trueforge-sdk, then
# add a path here.
python3 -c '
import re
from pathlib import Path

root = Path("python/trueforge_sdk")
dist = re.compile(
    r"(name\s*=\s*\"|metadata\.version\(\"|pip install |pypi/(?:v/)?|"
    r"\"User-Agent\":\s*\"|\"X-Fern-SDK-Name\":\s*\")trueforge_sdk"
)
for rel in (
    "pyproject.toml",
    "src/trueforge_sdk/version.py",
    "src/trueforge_sdk/_default_clients.py",
    "src/trueforge_sdk/core/client_wrapper.py",
    "tests/test_aiohttp_autodetect.py",
    "README.md",
):
    path = root / rel
    text = path.read_text()
    updated = dist.sub(lambda m: m.group(1) + "trueforge-sdk", text)
    if updated == text:
        raise SystemExit(f"expected dist-name trueforge_sdk stamp in {rel}")
    path.write_text(updated)
'
# Fern's generated verify.sh runs `pnpm install` from packages/trueforge-sdk, which now
# resolves to this workspace. CI sets frozen-lockfile, so refresh the root
# lockfile first or that install fails when the generator added/removed deps.
pnpm install --no-frozen-lockfile
(cd packages/trueforge-sdk && bash .fern/verify.sh)
