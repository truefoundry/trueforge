# Fern

OpenAPI and the SDKs are generated in CI (and locally via `pnpm sdk:generate`).
Edit server routes, not `openapi/openapi.json`, `packages/trueforge-sdk`, or
`python/trueforge_sdk`.

- TypeScript: `sdk-config.yml` (generator v4+, `fern generate --target typescript`).
- Python: `generators.legacy.yml` (`fern generate --group python-sdk`) until it migrates.

Bump: 1
