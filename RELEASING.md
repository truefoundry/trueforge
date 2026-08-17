# Releasing

This repository ships npm packages, a production container image (npm-install), a
Helm chart, and optional from-source **dev** images.

| What                                   | Trigger                                                             | Workflow                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| npm packages                           | Push to `main` (Changesets)                                         | [`.github/workflows/release.yml`](.github/workflows/release.yml)                                                 |
| Prod image + chart-release PR          | After `@truefoundry/trueforge` npm publish, or manual dispatch      | [`.github/workflows/build-and-prepare-chart-release.yml`](.github/workflows/build-and-prepare-chart-release.yml) |
| Chart tag, GitHub Release, OCI publish | Merge of `release-chart/trueforge`, or push of `charts/trueforge@*` | [`.github/workflows/release-chart.yml`](.github/workflows/release-chart.yml)                                     |
| Dev (from-source) image                | Manual `workflow_dispatch`                                          | [`.github/workflows/build-dev-image.yml`](.github/workflows/build-dev-image.yml)                                 |

## Versioning

| Artifact                     | Identity                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| npm `@truefoundry/trueforge` | SemVer `X.Y.Z` (source of truth for app bits)                                           |
| Chart `appVersion`           | Same as a **published** npm version                                                     |
| Prod image contents          | Root [`Dockerfile`](Dockerfile) installs `@truefoundry/trueforge@$APP_VERSION` from npm |
| Prod image tag               | `{appVersion}-{shortSha}` (recipe/base rebuild identity)                                |
| Chart `version`              | Independent SemVer; git tag `charts/trueforge@A.B.C` must match                         |
| Dev image                    | [`Dockerfile.dev`](Dockerfile.dev) from monorepo source; tag = full commit SHA          |

## Published packages

| Package                       | Source                    | Notes                                                           |
| ----------------------------- | ------------------------- | --------------------------------------------------------------- |
| `@truefoundry/trueforge-core` | `packages/trueforge-core` | Library (`files: ["dist", "README.md"]`)                        |
| `@truefoundry/trueforge`      | `packages/trueforge`      | App + CLI; tarball includes embedded UI under `dist/_frontend/` |
| `@truefoundry/trueforge-sdk`  | `packages/trueforge-sdk`  | Fern-generated client — do not hand-edit                        |
| `@truefoundry/trueforge-ui`   | `packages/trueforge-ui`   | Embeddable chat UI                                              |

`packages/frontend` is not published on its own. The server build copies its output into `@truefoundry/trueforge`'s `dist/_frontend/`.

Workspace dependencies use `workspace:*`. On publish, pnpm rewrites them to the exact version in each dependency's `package.json`. `changeset publish` publishes in dependency order, so a package never lands pointing at an unpublished sibling from the same run.

---

# npm packages

## Release flow

There is no `v*` git-tag publish. One workflow both versions and publishes, split into least-privilege jobs (`select-mode` → `version` | `pack` → `publish`):

1. **Add a changeset** in the same PR as the code change:

   ```bash
   pnpm changeset
   # non-interactive:
   pnpm change --bump patch --summary "…" @truefoundry/trueforge-core
   ```

   Name only the packages that should bump. A dependency can ship without its dependents. SDK regeneration on a PR already adds `@truefoundry/trueforge-sdk` via `pnpm changeset:sdk-regen`.

2. **Merge to `main`.** `.github/workflows/release.yml` runs. `changesets/action/select-mode` picks the path. With pending `.changeset/*.md` files, the **version** job opens or updates a **Version Packages** PR (`pnpm run version`: `changeset version`, then `pnpm sdk:generate` only if the SDK version moved). Review bumps and changelogs, then merge.

3. **Merge Version Packages to publish.** The same workflow sees no pending changesets: **pack** builds/tests and packs tarballs, then **publish** uploads them. Auth is npm trusted publishing over GitHub OIDC (`id-token` only on the publish job; no `NPM_TOKEN`).

   **Dist-tags:** while `.changeset/pre.json` exists (`pnpm changeset pre enter rc`), publishes use the `rc` tag. After `pnpm changeset pre exit`, the next Version Packages merge publishes to `latest`. Install an RC with `npx @truefoundry/trueforge@rc` or a concrete `x.y.z-rc.N` version.

4. **If `@truefoundry/trueforge` was published**, the same workflow calls **Build and prepare chart release**: builds the prod image for that npm version and opens/updates the chart-release bot PR (see below).

5. **Update downstream pins** that depend on these packages. Prefer exact versions (no `^`) during early `0.x` churn.

`workflow_dispatch` on **Release** re-runs the same workflow (useful after a bot-only commit that did not re-trigger it).

A push to `main` with no pending changesets still publishes any `package.json` version not yet on npm and no-ops the rest.

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

Packages publish from their package root. The core build emits CJS (`.js`), ESM (`.mjs`), and `.d.ts` under `dist/`; `package.json` `exports` point at those paths and `files: ["dist", "README.md"]` keeps `src/` out of the tarball.

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
cd packages/trueforge-core && pnpm build && pnpm pack
cd packages/trueforge && pnpm pack
```

Point consumers at a tarball with a `file:` dependency (or `yalc`) until a real version is published.

## npm trusted publishing

Each of the four packages must list this repository and workflow as a trusted publisher on npmjs.com:

- Repository: `truefoundry/trueforge`
- Workflow filename: `release.yml` (must match exactly)
- No GitHub Environment name (the publish job does not use one)

Configure the trusted-publisher row **before** the first publish for a new package. Do not set `NPM_TOKEN` or an `_authToken` in `.npmrc` on the publish job — that disables the OIDC exchange. Only the **publish** job has `id-token: write`.

## Troubleshooting

- **Version Packages PR never appears** — no `.changeset/*.md` on `main` (only `config.json` / `README.md` / `pre.json` remain). Add a changeset and merge, or run **Release** via `workflow_dispatch`.
- **Publish fails requiring a tag** — prerelease versions need the `rc` dist-tag. `changeset publish` sets that while pre mode is on; for a local publish use `pnpm publish --tag rc`.
- **Publish fails with 403/E403** — version already published (npm versions are immutable), or the trusted publisher config does not match the workflow filename/repo exactly.
- **OIDC/auth error** — requires pnpm >= 11.0.7 (native OIDC; `pnpm/action-setup@v4` reads `packageManager` from the root) and a matching trusted publisher config. Remove any registry `_authToken`.
- **Missing `dist/_frontend/index.html`** — root `pnpm build` must build `frontend` before `@truefoundry/trueforge`; the pack job fails closed if the copy is absent.
- **Version PR did not regenerate the SDK** — `scripts/version.mjs` only runs `pnpm sdk:generate` when `@truefoundry/trueforge-sdk`'s version changed. That step needs Docker (available on `ubuntu-latest`).

---

# Server image and Helm chart

Three lanes share one publish path: **tag `charts/trueforge@A.B.C` → OCI chart**.

```text
npm publish @truefoundry/trueforge@X.Y.Z
  → build Dockerfile (APP_VERSION=X.Y.Z) → push X.Y.Z-<shortSha>
  → bot PR (appVersion + chart version + image.tag)
  → merge PR → tag + GitHub Release → publish chart

manual dispatch (rebuild / same appVersion)
  → build + push → bot PR (chart version + image.tag)
  → merge → tag → publish chart

chart-only
  → human PR bumps chart version
  → human creates tag charts/trueforge@A.B.C
  → publish chart (no image rebuild)
```

Install a published chart with:

```bash
helm install trueforge oci://tfy.jfrog.io/tfy-helm/trueforge \
  --version <chart-semver>
```

## Dockerfiles

| File                               | Role                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`Dockerfile`](Dockerfile)         | **Prod / OSS.** `ARG APP_VERSION` (required). `npm install @truefoundry/trueforge@$APP_VERSION`.                         |
| [`Dockerfile.dev`](Dockerfile.dev) | **Dev / smoke.** From-source monorepo build. Used by [`docker-compose.yml`](docker-compose.yml) and **Build dev image**. |

Prod builds fail if the npm version is missing (no silent fallback to workspace source). That keeps `appVersion` honest even when `main` has already moved past the last npm release.

## Lane 1 — npm → image → chart PR

Automatic after Changesets publishes `@truefoundry/trueforge@X.Y.Z`:

1. Build/push `…/trueforge:X.Y.Z-<shortSha>` with `APP_VERSION=X.Y.Z`.
2. Open or update branch `release-chart/trueforge`: bump chart `version`, set `appVersion` to `X.Y.Z`, set `image.tag`.
3. **Merge the PR** → [`release-chart.yml`](.github/workflows/release-chart.yml) creates the annotated tag and GitHub Release, then publishes the OCI chart in the same workflow.
4. Human-pushed tags trigger the same workflow's publish job directly.

## Lane 2 — manual image rebuild

Actions → **Build and prepare chart release** (`workflow_dispatch`):

- Optional `app_version` (default: current `Chart.yaml` `appVersion`).
- Optional `update_app_version` (default false) — leave off for vuln/base rebuilds of the same npm version.
- Builds/pushes a new `{appVersion}-{shortSha}`, opens/updates the same bot PR (chart patch bump + `image.tag`).

```bash
gh workflow run build-and-prepare-chart-release.yml
# or pin app version:
gh workflow run build-and-prepare-chart-release.yml -f app_version=0.1.0
```

## Lane 3 — chart only

1. Human PR: bump `charts/trueforge/Chart.yaml` `version` (and any template/values changes). Leave `appVersion` / `image.tag` unless intentionally retargeting.
2. Merge to `main`.
3. Create the tag (and optionally GH Release) yourself:

```bash
git tag charts/trueforge@0.1.0
git push origin charts/trueforge@0.1.0
# or:
gh release create charts/trueforge@0.1.0 --title "charts/trueforge@0.1.0"
```

[`release-chart.yml`](.github/workflows/release-chart.yml) validates `Chart.yaml` `version` matches the tag suffix and publishes. No image rebuild.

## Bot PR conventions

| Item              | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Branch            | `release-chart/trueforge` (one open PR, updated in place)            |
| Auto-tag on merge | Only for this exact branch — ordinary merges never create chart tags |

You may edit the chart SemVer on the PR (minor/major) before merging; the tag follows `Chart.yaml` `version` at merge time.

## Dev / floating main

For internal deploy repos that track `main` via `git-helm-repo`:

1. Build a from-source image:

```bash
gh workflow run build-dev-image.yml --ref main
```

2. Image: `tfy.jfrog.io/tfy-images/trueforge:<fullSha>` (job summary prints the URI).
3. In the **external** `truefoundry.yaml`, set `image.tag` to that SHA. Keep secrets in `secretKeyRef` / platform secrets — never plaintext client secrets in git.

Optional: schedule or trigger `build-dev-image.yml` from the deploy repo (`gh workflow run`). Do not use SHA-tagged images as production chart defaults.

## Required repository configuration

**Variables:** `TRUEFOUNDRY_ARTIFACTORY_REGISTRY_URL`, `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_REPOSITORY`, `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_HELM_REPOSITORY`.

**Secrets:** `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_USERNAME`, `TRUEFOUNDRY_ARTIFACTORY_PUBLIC_PASSWORD`.

## Bundled chart dependencies

The chart optionally bundles Postgres and Redis (Bitnami subcharts from `oci://registry-1.docker.io/bitnamicharts`, pinned by `Chart.lock`). The chart publish workflow runs `helm dependency build` before packaging. Disable them with `postgresql.enabled=false` / `redis.enabled=false` to use external services.

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
