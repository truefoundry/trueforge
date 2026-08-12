# Releasing

Two public packages ship from this repo:

| Package                   | Source             | How it publishes                                                |
| ------------------------- | ------------------ | --------------------------------------------------------------- |
| `@truefoundry/utils-core` | `packages/harness` | From package root (`dist/`)                                     |
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

## Publishing model

The package publishes from the package root (`packages/harness`), same as
every other package in this repo. The build compiles every `src/**/*.ts` to
its own `.js` (CJS) + `.mjs` (ESM) + `.d.ts` triple under `dist/`, and
`package.json`'s `exports` map points at `./dist/...` paths; `files: ["dist"]`
scopes the published tarball to just the compiled output. Consequences:

- Deep imports keep the same specifier as before, e.g.
  `@truefoundry/utils-core/core/llm/LLMTypes` — the package's own `"./*"`
  export pattern maps that to `./dist/core/llm/LLMTypes.{d.ts,js,mjs}`
  internally, so no consumer using exports-aware resolution (`bundler`,
  `node16`, `nodenext`) needs to change anything. Only a genuinely legacy
  `moduleResolution: "node"`/`"node10"` consumer (which ignores `package.json`
  `exports` entirely and does literal on-disk path lookups) would need to add
  a `/dist/` segment or move to an exports-aware mode.
- `require()` and `import` both work (`.js` is CJS, `.mjs` is ESM).
- The curated barrels (`.`, `./core`, `./agent-session`) remain the public
  API; deep imports are the escape hatch for internals.
- `package.json` is published as-is (no staged rewrite), and it also carries a
  `"trueforge-dev"` export condition pointing at `./src/*.ts`, used only
  for dist-free host dev inside this monorepo (`packages/server`'s
  `NODE_OPTIONS='--conditions=trueforge-dev'` scripts). `src/` is **not**
  in the tarball (`files: ["dist"]`), so that condition name must never be a
  string a consumer's tooling activates automatically — it deliberately isn't
  `"development"`, which Vite/webpack default to auto-activating in dev mode
  with no consumer opt-in (Vite's default `resolve.conditions` substitutes the
  literal string `"development"` whenever `NODE_ENV !== 'production'`). A
  genuinely custom condition name like this one is only ever reachable by an
  explicit `--conditions=trueforge-dev` opt-in, which no external
  consumer would ever set — so it ships as truly inert dead weight.

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
   runs `pnpm publish` from `packages/harness`. (The `@truefoundry/utils`
   publish is deferred — see the note above.)

   Auth is trusted publishing (OIDC — no `NPM_TOKEN`). pnpm 11 implements the
   OIDC token exchange natively (no npm CLI involved). Watch the repo Actions tab.

   **Dist-tags:** CI passes an explicit `--tag` for prereleases, derived from the
   semver prerelease id (`0.2.0-rc.1` → `--tag rc`). Stable releases publish to
   `latest`. Install with `npx @truefoundry/utils@rc` or `@0.2.0-rc.1`; bare
   `npx @truefoundry/utils` stays on `latest`.

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
cd packages/harness && pnpm build && pnpm pack
cd packages/server && pnpm pack
```

Point consumers at a tarball via a `file:` dependency (or use `yalc`).
Publish a real version when CI or teammates need it.

## Troubleshooting

- **Publish fails requiring a tag**: prerelease versions need `--tag`.
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
  pnpm >= 11.0.7 (native OIDC token exchange; `pnpm/action-setup@v4` reads the
  pinned version from root `packageManager`) and the npmjs.com trusted
  publisher config (repo + workflow filename + ref) matching exactly.

## Deferred to the real OSS release — grep for `TODO(oss)`

Done: root LICENSE + MIT license fields, CONTRIBUTING, SECURITY,
CODE_OF_CONDUCT, issue/PR templates.

| Item                                                                               | Where                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Ship README (currently no `README.md` in `packages/harness`, npm page stays blank) | packages/harness                                        |
| Add repository/homepage/bugs/keywords metadata                                     | packages/harness/package.json                           |
| Add `--provenance` to publish                                                      | .github/workflows/release.yml                           |
| Private-repo links in shipped sandbox scripts                                      | packages/harness/src/core/sandbox/scripts/mcp_client.py |
| Sourcemaps/declarationMap decision                                                 | packages/harness/tsup.config.ts, tsconfig.build.json    |
| CODEOWNERS / CI for external (fork) PRs                                            | .github/                                                |
| Secret-scan history, enable secret scanning + push protection, flip repo public    | GitHub settings                                         |

---

# Releasing the server image + Helm chart

A separate pipeline ships the deployable artifacts: the server container image
(API + UI, built from the root `Dockerfile`) and the `charts/truefoundry-utils` Helm
chart. It is driven by `.github/workflows/release-image-and-chart.yml` and runs
only on manual **`workflow_dispatch`** (Actions → "Release image and Helm chart"
→ Run workflow).

## What the workflow does

The dispatch commit SHA is the image tag. The workflow:

1. **Builds and pushes the image** via the shared reusable workflow
   `truefoundry/github-workflows-public/.github/workflows/build.yml@main` to the
   JFrog public Artifactory repo, tagged with `github.sha`. The chart pulls the
   image from JFrog, so JFrog is the only publish target (public ECR is disabled).
2. **Stamps the chart in the runner workspace** — sets `Chart.yaml`
   `version` to `0.0.0-<sha>` (Helm SemVer-compatible prerelease), and
   `appVersion` / `image.tag` to the raw SHA. It does **not** commit those
   stamps back to `main`.
3. **Publishes the chart** — packages `charts/truefoundry-utils` and pushes it to
   the JFrog public OCI Helm repo. It does not attach artifacts to a GitHub
   Release.

## Per-release flow

1. On the commit you want to ship, run the workflow from the Actions tab (or
   `gh workflow run release-image-and-chart.yml`).
2. Watch the run. The image and chart land in JFrog; the job summary prints the
   image URI.

> Publishing `@truefoundry/utils-core` (via `pnpm publish`) is a separate pipeline
> (`release.yml`) triggered by a `vX.Y.Z` GitHub Release tag that must match
> `packages/harness/package.json`. It is independent of this image/chart
> workflow.

## Required repository configuration

Org/repo **variables**: `TRUEFOUNDRY_ARTIFACTORY_REGISTRY_URL`,
`TRUEFOUNDRY_ARTIFACTORY_PUBLIC_REPOSITORY`,
`TRUEFOUNDRY_ARTIFACTORY_PUBLIC_HELM_REPOSITORY`.

Org/repo **secrets**: `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_USERNAME`,
`TRUEFOUNDRY_ARTIFACTORY_PUBLIC_PASSWORD`.

## Bundled dependencies

The chart bundles Postgres and Redis as optional Bitnami subcharts, declared in
`charts/truefoundry-utils/Chart.yaml` against the public Bitnami OCI archive
(`oci://registry-1.docker.io/bitnamicharts`) and pinned by the committed
`Chart.lock`. The workflow fetches them with `helm dependency build` before
packaging (the archive is public, no auth). Disable them with
`postgresql.enabled=false` / `redis.enabled=false` to target external services.

**Images vs charts.** Bitnami left the charts public but relocated their
container images to `docker.io/bitnamilegacy` (frozen, no security updates). So
`charts/truefoundry-utils/values.yaml` overrides the subchart images to pinned legacy
tags mirrored to the TrueFoundry JFrog registry, and sets
`global.security.allowInsecureImages: true` (required once the registry differs
from Bitnami's default). Mirror the images once per pinned tag:

```bash
for img in \
  postgresql:17.6.0-debian-12-r4 \
  redis:8.2.1-debian-12-r0; do
  crane copy "docker.io/bitnamilegacy/${img}" "tfy.jfrog.io/tfy-mirror/bitnamilegacy/${img}"
done
# If you enable metrics/volumePermissions, also mirror:
#   postgres-exporter:0.17.1-debian-12-r16  os-shell:12-debian-12-r51
#   redis-exporter:1.76.0-debian-12-r0
```

To bump a bundled version: change the version under `dependencies:` in
`Chart.yaml`, run `pnpm chart:deps` to refresh `Chart.lock`, then update the
matching `image.tag` in `values.yaml` and mirror that new legacy tag to JFrog.

## Validating the chart locally

Fetch the subchart deps first (public archive, no auth), then lint/template:

```bash
pnpm chart:deps       # helm dependency build (writes charts/, uses Chart.lock)
pnpm chart:lint       # helm lint with charts/truefoundry-utils/ci/lint-values.yaml
pnpm chart:template   # render the manifests
pnpm chart:package    # package to dist/ (gitignored)
```
