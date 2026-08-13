# Releasing

Two pipelines ship from this repo:

| What                      | Trigger                     | Workflow                                                                                         |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| Four public npm packages  | Push to `main` (Changesets) | [`.github/workflows/release.yml`](.github/workflows/release.yml)                                 |
| Server image + Helm chart | Manual `workflow_dispatch`  | [`.github/workflows/release-image-and-chart.yml`](.github/workflows/release-image-and-chart.yml) |

They are independent. Publishing npm does not stamp or push the chart, and the chart workflow does not publish npm.

| Package                       | Source                      | Notes                                          |
| ----------------------------- | --------------------------- | ---------------------------------------------- |
| `@truefoundry/trueforge-core` | `packages/harness`          | Library. `files: ["dist"]`.                    |
| `@truefoundry/trueforge`      | `packages/server`           | App + CLI. Tarball includes `dist/_frontend/`. |
| `@truefoundry/trueforge-sdk`  | `packages/sdk`              | Fern-generated client. Do not hand-edit.       |
| `@truefoundry/trueforge-ui`   | `packages/trueforge-ui-sdk` | Embeddable chat UI.                            |

`frontend` is private and is not published; the server build copies its output into `dist/_frontend/`.

Internal deps use `workspace:*`. On publish, pnpm rewrites those to the exact version in the dependency's `package.json`. `changeset publish` publishes in dependency order (core before server, sdk before ui), so a published dependent never points at an unpublished dep from the same run.

---

# Releasing npm packages

## Per-release flow

There is no `v*` git-tag publish. One workflow both versions and publishes:

1. **Land a changeset on `main`.** In the same PR as the code change:

   ```bash
   pnpm changeset
   # or, non-interactive:
   pnpm change --bump patch --summary "…" @truefoundry/trueforge-core
   ```

   Name only the packages that should bump. A dep can ship without its dependent (the dependent's `workspace:*` stays untouched until that package is itself changeset + published). SDK regen on a PR already adds `@truefoundry/trueforge-sdk` via `pnpm changeset:sdk-regen`.

2. **Merge to `main`.** `.github/workflows/release.yml` runs. If `.changeset/*.md` files are pending, the job skips build/test (the Version Packages PR is gated by CI.yml) and `changesets/action` opens (or updates) a **Version Packages** PR. That PR is `pnpm run version`: `changeset version`, then `pnpm sdk:generate` only if `@truefoundry/trueforge-sdk`'s version actually moved (Fern rebakes version literals). Review the version bumps and CHANGELOGs, then merge.

3. **Merging Version Packages publishes.** The same workflow sees no pending changesets and runs `pnpm release` (`pnpm build && changeset publish`). Auth is trusted publishing (OIDC — no `NPM_TOKEN`). pnpm 11 implements the OIDC token exchange natively. Watch the repo Actions tab.

   **Dist-tags:** while `.changeset/pre.json` exists (`pnpm changeset pre enter rc`), publishes use the `rc` dist-tag, not `latest`. After `pnpm changeset pre exit`, the next Version Packages merge publishes to `latest`. Install an RC with `npx @truefoundry/trueforge@rc` or `@0.1.0-rc.1`; bare `npx @truefoundry/trueforge` stays on `latest`.

4. **Bump the pinned version in downstream consumers** (e.g. the gateway). Pin exact versions (no `^`) during the fast 0.x churn:

   ```json
   "@truefoundry/trueforge-core": "0.x.y"
   ```

`workflow_dispatch` on **Release** re-runs the same job (useful after a bot-only commit that GitHub did not chain into this workflow).

A push to `main` with **no** pending changesets still runs `changeset publish`, which publishes any package whose current `package.json` version is not yet on npm and no-ops the rest. The first time this workflow lands on `main`, unpublished packages at `0.1.0-rc.1` will try to publish.

## Prerelease mode

Pre mode is repo-wide (`.changeset/pre.json`), not per-package. The repo is currently in `rc`.

| Goal                 | Command                       | Then                                                                      |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Stay on RCs          | (already in pre)              | Normal PRs + Version Packages. Versions look like `0.1.0-rc.N`.           |
| Ship stable `latest` | `pnpm changeset pre exit`     | Commit the deleted `pre.json`, merge, then merge the Version Packages PR. |
| Start a new RC line  | `pnpm changeset pre enter rc` | Commit `pre.json`, merge, continue as above.                              |

`pre enter` / `pre exit` do not bump versions or publish. The Version Packages PR is what versions; merging it is what publishes.

Do not mix “this package stable, that package RC” in one `changeset version` — exit pre only when the next publish should be GA.

## Publishing model (`@truefoundry/trueforge-core`)

The package publishes from the package root (`packages/harness`), same as every other package in this repo. The build compiles every `src/**/*.ts` to its own `.js` (CJS) + `.mjs` (ESM) + `.d.ts` triple under `dist/`, and `package.json`'s `exports` map points at `./dist/...` paths; `files: ["dist"]` scopes the published tarball to just the compiled output. Consequences:

- Deep imports keep the same specifier as before, e.g.
  `@truefoundry/trueforge-core/core/llm/LLMTypes` — the package's own `"./*"`
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

> **Reality check we've accepted:** a public npm package is discoverable
> regardless of its name (npm's public change feed is scraped, and the
> package is listed on npmjs.com/org/truefoundry). Anything that must NOT be
> effectively public should not ship in the tarball. Note: sourcemaps are
> currently **enabled** (`sourcemap: true` in tsup, `declarationMap` in
> tsconfig.build.json), which embeds/references original TypeScript source in
> the published tarball — this is a deliberate, accepted trade-off for now.
> Every deferred OSS item carries a `TODO(oss):` comment so we can grep for
> them when that day comes.

## Why dependents pin exact versions

`@truefoundry/trueforge` depends on `@truefoundry/trueforge-core: workspace:*` (and `@truefoundry/trueforge-ui` on the sdk the same way). On publish, pnpm rewrites that to the **version in the dependency's `package.json`**. If that version is missing from npm, `npx @truefoundry/trueforge` fails at runtime. Changeset both packages in the same Version Packages PR when the dependent uses new APIs from the dep.

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

## npm trusted publishing

Each of the four packages must list this repo + workflow as a trusted publisher on npmjs.com:

- Repository: `truefoundry/trueforge`
- Workflow filename: `release.yml` (must match exactly; renaming the file breaks publish)
- No environment name (the job does not use a GitHub Environment)

Packages that have never been published need that trusted-publisher row **before** the first `changeset publish` (npm allows creating a package via OIDC when the org is configured for it). `@truefoundry/trueforge-core` already publishes this way; sdk / ui / server need the same config before they can land.

## Troubleshooting

- **Version Packages PR never appears**: no `.changeset/*.md` on `main` (only `config.json` / `README.md` / `pre.json` stay). Add a changeset in a PR and merge, or run **Release** via `workflow_dispatch`.
- **Publish fails requiring a tag**: prerelease versions need the `rc` dist-tag. `changeset publish` sets that while pre mode is on; for a local publish use `pnpm publish --tag rc`.
- **Publish fails with 403/E403**: version already published (npm versions are immutable — add a changeset and merge Version Packages again), or the trusted publisher config doesn't match the workflow filename/repo exactly.
- **OIDC/auth error in the publish step**: trusted publishing requires pnpm >= 11.0.7 (native OIDC; `pnpm/action-setup@v4` reads the pinned version from root `packageManager`) and the npmjs.com trusted publisher config matching exactly. Do not set `NPM_TOKEN` — a registry `_authToken` disables the OIDC exchange.
- **Missing `dist/_frontend/index.html`**: root `pnpm build` must build `frontend` before `@truefoundry/trueforge`; the release job fails closed if the copy is absent.
- **Version PR did not regenerate the SDK**: `scripts/version.mjs` only runs `pnpm sdk:generate` when `@truefoundry/trueforge-sdk`'s version changed. That step needs Docker on the runner (already true on `ubuntu-latest`).

## Deferred to the real OSS release — grep for `TODO(oss)`

Done: root LICENSE + MIT license fields, CONTRIBUTING, SECURITY,
CODE_OF_CONDUCT, issue/PR templates.

| Item                                                                               | Where                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Ship README (currently no `README.md` in `packages/harness`, npm page stays blank) | packages/harness                                        |
| Add `--provenance` to publish                                                      | .github/workflows/release.yml                           |
| Private-repo links in shipped sandbox scripts                                      | packages/harness/src/core/sandbox/scripts/mcp_client.py |
| Sourcemaps/declarationMap decision                                                 | packages/harness/tsup.config.ts, tsconfig.build.json    |
| CODEOWNERS / CI for external (fork) PRs                                            | .github/                                                |
| Secret-scan history, enable secret scanning + push protection, flip repo public    | GitHub settings                                         |

---

# Releasing the server image + Helm chart

A separate pipeline ships the deployable artifacts: the server container image
(API + UI, built from the root `Dockerfile`) and the `charts/trueforge` Helm
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
3. **Publishes the chart** — packages `charts/trueforge` and pushes it to
   the JFrog public OCI Helm repo. It does not attach artifacts to a GitHub
   Release.

## Per-release flow

1. On the commit you want to ship, run the workflow from the Actions tab (or
   `gh workflow run release-image-and-chart.yml`).
2. Watch the run. The image and chart land in JFrog; the job summary prints the
   image URI.

> Publishing the npm packages is a separate pipeline (`release.yml`) triggered
> by pushes to `main` via Changesets. It is independent of this image/chart
> workflow.

## Required repository configuration

Org/repo **variables**: `TRUEFOUNDRY_ARTIFACTORY_REGISTRY_URL`,
`TRUEFOUNDRY_ARTIFACTORY_PUBLIC_REPOSITORY`,
`TRUEFOUNDRY_ARTIFACTORY_PUBLIC_HELM_REPOSITORY`.

Org/repo **secrets**: `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_USERNAME`,
`TRUEFOUNDRY_ARTIFACTORY_PUBLIC_PASSWORD`.

## Bundled dependencies

The chart bundles Postgres and Redis as optional Bitnami subcharts, declared in
`charts/trueforge/Chart.yaml` against the public Bitnami OCI archive
(`oci://registry-1.docker.io/bitnamicharts`) and pinned by the committed
`Chart.lock`. The workflow fetches them with `helm dependency build` before
packaging (the archive is public, no auth). Disable them with
`postgresql.enabled=false` / `redis.enabled=false` to target external services.

**Images vs charts.** Bitnami left the charts public but relocated their
container images to `docker.io/bitnamilegacy` (frozen, no security updates). So
`charts/trueforge/values.yaml` overrides the subchart images to pinned legacy
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
pnpm chart:lint       # helm lint with charts/trueforge/ci/lint-values.yaml
pnpm chart:template   # render the manifests
pnpm chart:package    # package to dist/ (gitignored)
```
