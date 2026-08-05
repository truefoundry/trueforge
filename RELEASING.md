# Releasing

Two public packages ship from this repo:

| Package                   | Source             | How it publishes                                                |
| ------------------------- | ------------------ | --------------------------------------------------------------- |
| `@truefoundry/utils-core` | `packages/harness` | From staged `packages/harness/dist` (library)                   |
| `@truefoundry/utils`      | `packages/server`  | From package root (`dist/`, including `dist/_frontend/` for UI) |

The git tag `v*` must match **`packages/harness` (`@truefoundry/utils-core`) version**.
`@truefoundry/utils` may use an independent version — bump it in the same release PR
whenever the app/CLI changes. CI publishes **core first**, then utils (so
`workspace:*` rewrites to the core version that just landed on npm).

> **Currently only `@truefoundry/utils-core` publishes.** The `@truefoundry/utils`
> publish step in `release.yml` is deferred (`TODO`); CI still builds and tests it.

---

# Releasing `@truefoundry/utils-core`

Interim setup for the fast development phase: the library in
`packages/harness` is published **publicly** to npm as `@truefoundry/utils-core`
so the gateway can consume it like any normal dependency. The real
open-source release happens later — every deferred item carries a
`TODO(oss):` comment in code so we can grep for them when that day comes.

> **Reality check we've accepted:** a public npm package is discoverable
> regardless of its name (npm's public change feed is scraped, and the
> package is listed on npmjs.com/org/truefoundry). Anything that must NOT be
> effectively public should not ship in the tarball. Note: sourcemaps are
> currently **enabled** (`sourcemap: true` in tsup, `declarationMap` in
> tsconfig.build.json), which embeds/references original TypeScript source in
> the published tarball — this is a deliberate, accepted trade-off for now.

## Publishing model (openai-node style)

The package publishes **from `packages/harness/dist`**, not the package
folder. The build compiles every `src/**/*.ts` to its own `.js` (CJS) +
`.mjs` (ESM) + `.d.ts` triple and generates `dist/package.json` with
dist-relative paths (`scripts/make-dist-package-json.mjs`), so the tarball
root is the compiled file tree. Consequences:

- Deep imports mirror the source tree with no `dist/` segment:
  `@truefoundry/utils-core/core/llm/LLMTypes`, `.../core/runtime/contextUtils`.
- Legacy `moduleResolution: "node"` consumers (the gateway) resolve subpaths
  as literal file lookups — no `exports`/`typesVersions` support needed.
- `require()` and `import` both work (`.js` is CJS, `.mjs` is ESM).
- The curated barrels (`.`, `./core`, `./agent-session`) remain the public
  API; deep imports are the escape hatch for internals.

## Per-release flow

1. **Bump versions via PR** (direct pushes to `main` are blocked by org
   ruleset):

   ```bash
   git checkout -b release/v0.x.y
   cd packages/harness
   npm version 0.x.y --no-git-tag-version   # or 0.x.y-rc.N for a prerelease
   cd ../server
   npm version 0.x.y --no-git-tag-version   # bump when the app/CLI changes; may differ from core
   cd ../..
   git add packages/harness/package.json packages/server/package.json
   git commit -m "chore: release v0.x.y"
   git push -u origin release/v0.x.y
   ```

   Open the PR, get 1 approval, squash-merge.

2. **Tag the merged commit** (tags trigger the publish):

   ```bash
   git checkout main && git pull
   git tag v0.x.y          # must equal packages/harness version (e.g. v0.1.9-rc.1)
   git push origin v0.x.y
   ```

3. **CI publishes automatically.** `.github/workflows/release.yml` installs,
   builds, tests, verifies the tag matches `packages/harness/package.json`, then
   runs `npm publish` **from `packages/harness/dist`**. (The `@truefoundry/utils`
   publish is deferred — see the note above.)

   Auth is trusted publishing (OIDC — no `NPM_TOKEN`). Watch the repo Actions tab.

   **Dist-tags:** npm 11 requires an explicit `--tag` for prereleases. CI derives
   it from the semver prerelease id (`0.2.0-rc.1` → `--tag rc`). Stable releases
   publish to `latest`. Install with `npx @truefoundry/utils@rc` or
   `@0.2.0-rc.1`; bare `npx @truefoundry/utils` stays on `latest`.

4. **Bump the pinned version in the gateway.** Pin exact versions (no `^`)
   during the fast 0.x churn:

   ```json
   "@truefoundry/utils-core": "0.x.y"
   ```

## Why core must publish before utils

`@truefoundry/utils` depends on `@truefoundry/utils-core: workspace:*`. On
publish, pnpm rewrites that to the **version in `packages/harness/package.json`**.
If that core version is missing from npm (or is an older build without exports
the server imports), `npx @truefoundry/utils` fails at runtime. Always ship
matching core+utils together when the app uses new core APIs.

## Local iteration without publishing

For tight loops, skip the publish round-trip:

```bash
pnpm clean && pnpm build && pnpm standalone:start
# or pack only:
cd packages/harness && pnpm build && cd dist && pnpm pack
cd packages/server && pnpm pack
```

Point consumers at a tarball via a `file:` dependency (or use `yalc`).
Publish a real version when CI or teammates need it.

## Troubleshooting

- **Publish fails requiring a tag**: prerelease versions need `--tag` (npm 11).
  CI handles this; for local publishes use e.g. `pnpm publish --tag rc`.
- **Publish fails with 403/E403**: version already published (npm versions
  are immutable — bump and re-tag), or the trusted publisher config doesn't
  match the workflow filename/repo exactly.
- **Tag/version mismatch failure**: the guard step caught a tag that doesn't
  match `packages/harness/package.json`. Delete the tag
  (`git push origin :refs/tags/vX.Y.Z`), fix the version via PR, re-tag.
- **Missing `dist/_frontend/index.html`**: root `pnpm build` must build
  `frontend` before `@truefoundry/utils`; the release job fails closed if the
  copy is absent.
- **OIDC/auth error in the publish step**: trusted publishing requires
  npm >= 11.5.1; the workflow upgrades npm globally before publishing —
  check that step ran.

## Deferred to the real OSS release — grep for `TODO(oss)`

| Item                                                                            | Where                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| License: UNLICENSED → Apache-2.0 + LICENSE file                                 | both package.jsons, repo root                           |
| Ship README (guard lives in make-dist-package-json.mjs)                         | packages/harness/scripts                                |
| Add repository/homepage/bugs/keywords metadata                                  | packages/harness/package.json                           |
| Add `--provenance` to publish                                                   | .github/workflows/release.yml                           |
| Replace `internal.devtest.truefoundry.tech` URLs                                | packages/server/src/config                              |
| Private-repo links in shipped sandbox scripts                                   | packages/harness/src/core/sandbox/scripts/mcp_client.py |
| Sourcemaps/declarationMap decision                                              | packages/harness/tsup.config.ts, tsconfig.build.json    |
| CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / CODEOWNERS / CI for external PRs    | .github/                                                |
| Secret-scan history, enable secret scanning + push protection, flip repo public | GitHub settings                                         |
