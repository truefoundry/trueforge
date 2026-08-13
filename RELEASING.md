# Releasing

This repository ships two independent release pipelines:

| What                      | Trigger                     | Workflow                                                                                         |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| npm packages              | Push to `main` (Changesets) | [`.github/workflows/release.yml`](.github/workflows/release.yml)                                 |
| Server image + Helm chart | Manual `workflow_dispatch`  | [`.github/workflows/release-image-and-chart.yml`](.github/workflows/release-image-and-chart.yml) |

Publishing npm does not stamp or push the chart. Publishing the image/chart does not publish npm.

## Published packages

| Package                       | Source                      | Notes                                                           |
| ----------------------------- | --------------------------- | --------------------------------------------------------------- |
| `@truefoundry/trueforge-core` | `packages/harness`          | Library (`files: ["dist"]`)                                     |
| `@truefoundry/trueforge`      | `packages/server`           | App + CLI; tarball includes embedded UI under `dist/_frontend/` |
| `@truefoundry/trueforge-sdk`  | `packages/sdk`              | Fern-generated client — do not hand-edit                        |
| `@truefoundry/trueforge-ui`   | `packages/trueforge-ui-sdk` | Embeddable chat UI                                              |

`packages/frontend` is not published on its own. The server build copies its output into `@truefoundry/trueforge`'s `dist/_frontend/`.

Workspace dependencies use `workspace:*`. On publish, pnpm rewrites them to the exact version in each dependency's `package.json`. `changeset publish` publishes in dependency order, so a package never lands pointing at an unpublished sibling from the same run.

---

# npm packages

## Release flow

There is no `v*` git-tag publish. One workflow both versions and publishes:

1. **Add a changeset** in the same PR as the code change:

   ```bash
   pnpm changeset
   # non-interactive:
   pnpm change --bump patch --summary "…" @truefoundry/trueforge-core
   ```

   Name only the packages that should bump. A dependency can ship without its dependents. SDK regeneration on a PR already adds `@truefoundry/trueforge-sdk` via `pnpm changeset:sdk-regen`.

2. **Merge to `main`.** `.github/workflows/release.yml` runs. With pending `.changeset/*.md` files, `changesets/action` opens or updates a **Version Packages** PR (`pnpm run version`: `changeset version`, then `pnpm sdk:generate` only if the SDK version moved). Review bumps and changelogs, then merge.

3. **Merge Version Packages to publish.** The same workflow sees no pending changesets and runs `pnpm release` (`pnpm build && changeset publish`). Auth is npm trusted publishing over GitHub OIDC (no `NPM_TOKEN`).

   **Dist-tags:** while `.changeset/pre.json` exists (`pnpm changeset pre enter rc`), publishes use the `rc` tag. After `pnpm changeset pre exit`, the next Version Packages merge publishes to `latest`. Install an RC with `npx @truefoundry/trueforge@rc` or a concrete `x.y.z-rc.N` version.

4. **Update downstream pins** that depend on these packages. Prefer exact versions (no `^`) during early `0.x` churn.

`workflow_dispatch` on **Release** re-runs the same job (useful after a bot-only commit that did not re-trigger the workflow).

A push to `main` with no pending changesets still runs `changeset publish`, which publishes any `package.json` version not yet on npm and no-ops the rest.

## Prerelease mode

Pre mode is repo-wide (`.changeset/pre.json`), not per-package. The repo is currently in `rc`.

| Goal                 | Command                       | Then                                                                      |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Stay on RCs          | (already in pre)              | Normal PRs + Version Packages. Versions look like `x.y.z-rc.N`.           |
| Ship stable `latest` | `pnpm changeset pre exit`     | Commit the deleted `pre.json`, merge, then merge the Version Packages PR. |
| Start a new RC line  | `pnpm changeset pre enter rc` | Commit `pre.json`, merge, continue as above.                              |

`pre enter` / `pre exit` do not bump versions or publish. The Version Packages PR versions; merging it publishes.

Do not mix stable and RC packages in one `changeset version` — exit pre only when the next publish should be GA.

## Package layout (`@truefoundry/trueforge-core`)

Packages publish from their package root. The core build emits CJS (`.js`), ESM (`.mjs`), and `.d.ts` under `dist/`; `package.json` `exports` point at those paths and `files: ["dist"]` limits the tarball to compiled output.

- Deep imports such as `@truefoundry/trueforge-core/core/llm/LLMTypes` resolve via the package `exports` map for modern `moduleResolution` modes (`bundler`, `node16`, `nodenext`).
- Curated barrels (`.`, `./core`, `./agent-session`) are the supported public API; deep imports are an escape hatch.
- A custom `"trueforge-dev"` export condition points at `./src` for dist-free monorepo development only. `src/` is not in the tarball, and the condition is not named `"development"`, so external tooling will not activate it accidentally.

Sourcemaps / declaration maps are currently enabled in the published tarball.

## Why dependents pin exact versions

On publish, `workspace:*` becomes the **exact version** in the dependency's `package.json`. If that version is missing from npm, consumers fail at install/runtime. Changeset both packages together when a dependent needs new APIs from its dependency.

## Local iteration without publishing

```bash
pnpm clean && pnpm build && pnpm standalone:start
# or pack only:
cd packages/harness && pnpm build && pnpm pack
cd packages/server && pnpm pack
```

Point consumers at a tarball with a `file:` dependency (or `yalc`) until a real version is published.

## npm trusted publishing

Each of the four packages must list this repository and workflow as a trusted publisher on npmjs.com:

- Repository: `truefoundry/trueforge`
- Workflow filename: `release.yml` (must match exactly)
- No GitHub Environment name (the job does not use one)

Configure the trusted-publisher row **before** the first `changeset publish` for a new package. Do not set `NPM_TOKEN` or an `_authToken` in `.npmrc` on the release job — that disables the OIDC exchange.

## Troubleshooting

- **Version Packages PR never appears** — no `.changeset/*.md` on `main` (only `config.json` / `README.md` / `pre.json` remain). Add a changeset and merge, or run **Release** via `workflow_dispatch`.
- **Publish fails requiring a tag** — prerelease versions need the `rc` dist-tag. `changeset publish` sets that while pre mode is on; for a local publish use `pnpm publish --tag rc`.
- **Publish fails with 403/E403** — version already published (npm versions are immutable), or the trusted publisher config does not match the workflow filename/repo exactly.
- **OIDC/auth error** — requires pnpm >= 11.0.7 (native OIDC; `pnpm/action-setup@v4` reads `packageManager` from the root) and a matching trusted publisher config. Remove any registry `_authToken`.
- **Missing `dist/_frontend/index.html`** — root `pnpm build` must build `frontend` before `@truefoundry/trueforge`; the release job fails closed if the copy is absent.
- **Version PR did not regenerate the SDK** — `scripts/version.mjs` only runs `pnpm sdk:generate` when `@truefoundry/trueforge-sdk`'s version changed. That step needs Docker (available on `ubuntu-latest`).

---

# Server image and Helm chart

A separate pipeline ships the deployable artifacts: the server container image (API + UI, built from the root `Dockerfile`) and the `charts/trueforge` Helm chart. It is driven by `.github/workflows/release-image-and-chart.yml` and runs only on manual **`workflow_dispatch`** (Actions → **Release image and Helm chart** → Run workflow).

Install a published chart with:

```bash
helm install trueforge oci://tfy.jfrog.io/tfy-helm/trueforge \
  --version <x.y.z>
```

## What the workflow does

The dispatch commit SHA is the image tag. The workflow:

1. **Builds and pushes the image** via `truefoundry/github-workflows-public/.github/workflows/build.yml@main` to the public JFrog Artifactory repository, tagged with `github.sha`.
2. **Stamps the chart in the runner workspace** — sets `Chart.yaml` `version` to `0.0.0-<sha>` (Helm SemVer-compatible prerelease), and `appVersion` / `image.tag` to the raw SHA. Those stamps are **not** committed back to `main`.
3. **Publishes the chart** — packages `charts/trueforge` and pushes it to the JFrog public OCI Helm repository (`oci://tfy.jfrog.io/tfy-helm`). It does not attach artifacts to a GitHub Release.

## Per-release flow

1. On the commit you want to ship, run the workflow from the Actions tab (or `gh workflow run release-image-and-chart.yml`).
2. Watch the run. The image and chart land in JFrog; the job summary prints the image URI.

## Required repository configuration

**Variables:** `TRUEFOUNDRY_ARTIFACTORY_REGISTRY_URL`, `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_REPOSITORY`, `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_HELM_REPOSITORY`.

**Secrets:** `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_USERNAME`, `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_PASSWORD`.

## Bundled chart dependencies

The chart optionally bundles Postgres and Redis (Bitnami subcharts from `oci://registry-1.docker.io/bitnamicharts`, pinned by `Chart.lock`). The workflow runs `helm dependency build` before packaging. Disable them with `postgresql.enabled=false` / `redis.enabled=false` to use external services.

Bitnami left the charts public but moved versioned container images to `docker.io/bitnamilegacy`. `charts/trueforge/values.yaml` points the subcharts at pinned tags mirrored on JFrog and sets `global.security.allowInsecureImages: true`. Mirror once per pinned tag:

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

To bump a bundled version: change `dependencies:` in `Chart.yaml`, run `pnpm chart:deps`, update the matching `image.tag` in `values.yaml`, and mirror the new legacy tag to JFrog.

## Validating the chart locally

```bash
pnpm chart:deps       # helm dependency build (uses Chart.lock)
pnpm chart:lint       # helm lint with charts/trueforge/ci/lint-values.yaml
pnpm chart:template   # render manifests
pnpm chart:package    # package to dist/ (gitignored)
```
