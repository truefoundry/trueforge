# Releasing

This repo ships npm packages, a production container image, a Helm chart, a
sandbox image, and optional from-source **dev** images.

| What                                | Trigger                                                                            | Workflow                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| npm packages                        | Push to `main` (Changesets)                                                        | [`release.yml`](.github/workflows/release.yml)                                                 |
| Prod image + chart-release PR       | After `@truefoundry/trueforge` npm publish (reusable workflow), or manual dispatch | [`build-and-prepare-chart-release.yml`](.github/workflows/build-and-prepare-chart-release.yml) |
| Chart tag, GitHub Release, OCI push | Merge of `release-chart/trueforge`, or push/dispatch of `charts/trueforge@*`       | [`release-chart.yml`](.github/workflows/release-chart.yml)                                     |
| Sandbox image + pin PR              | Push to `main` when `scripts/sandbox/**` changes, or dispatch                      | [`push-sandbox-image.yml`](.github/workflows/push-sandbox-image.yml)                           |
| Dev (from-source) image             | Manual `workflow_dispatch`                                                         | [`build-dev-image.yml`](.github/workflows/build-dev-image.yml)                                 |

## Versioning

| Artifact                     | Identity                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| npm `@truefoundry/trueforge` | SemVer `X.Y.Z` — source of truth for app bits                                                             |
| Chart `appVersion`           | A **published** npm version                                                                               |
| Prod image                   | Root [`Dockerfile`](Dockerfile): `npm install @truefoundry/trueforge@$APP_VERSION`                        |
| Prod image tag               | `{appVersion}-{shortSha}` (shortSha of the build commit)                                                  |
| Chart `version`              | Independent SemVer; git tag `charts/trueforge@A.B.C` must match                                           |
| Sandbox image                | [`sandbox.Dockerfile`](packages/trueforge-core/scripts/sandbox/sandbox.Dockerfile); tag = full commit SHA |
| Dev image                    | [`Dockerfile.dev`](Dockerfile.dev); tag = full commit SHA                                                 |

Install a published chart:

```bash
helm install trueforge oci://tfy.jfrog.io/tfy-helm/trueforge --version <chart-semver>
```

---

# npm packages

| Package                       | Source                    | Notes                                         |
| ----------------------------- | ------------------------- | --------------------------------------------- |
| `@truefoundry/trueforge-core` | `packages/trueforge-core` | Library                                       |
| `@truefoundry/trueforge`      | `packages/trueforge`      | App + CLI; tarball includes `dist/_frontend/` |
| `@truefoundry/trueforge-sdk`  | `packages/trueforge-sdk`  | Fern-generated — do not hand-edit             |
| `@truefoundry/trueforge-ui`   | `packages/trueforge-ui`   | Embeddable chat UI                            |

`packages/frontend` is not published; its build is copied into `@truefoundry/trueforge`'s tarball.
`workspace:*` is rewritten to exact versions on publish.

## Flow

No `v*` tag publish. [`release.yml`](.github/workflows/release.yml) does both version and publish
(`select-mode` → `version` \| `pack` → `publish`):

1. Add a changeset in the same PR as the code change (`pnpm changeset`, or
   `pnpm change --bump patch --summary "…" <pkg>`). SDK regen already adds
   `@truefoundry/trueforge-sdk` via `pnpm changeset:sdk-regen`.
2. Merge to `main`. Pending changesets → **Version Packages** PR
   (`pnpm run version`). Review and merge.
3. With no pending changesets, **pack** (build/test) then **publish** via npm
   trusted publishing (OIDC; no `NPM_TOKEN`).
4. If `@truefoundry/trueforge` was published, **Release** calls **Build and
   prepare chart release** as a reusable workflow on the same commit (so a
   newer `main` push cannot change the Dockerfile / shortSha). GitHub's
   `workflow_dispatch` API only accepts a branch or tag name, not a SHA.
5. Pin dependents to exact versions during early `0.x`.

`workflow_dispatch` on **Release** re-runs the same workflow.

## Prerelease mode

Repo-wide via `.changeset/pre.json` (absent = publish to `latest`):

| Goal     | Command                       | Then                                                                      |
| -------- | ----------------------------- | ------------------------------------------------------------------------- |
| Enter RC | `pnpm changeset pre enter rc` | Commit `pre.json`, merge; versions look like `x.y.z-rc.N` (`rc` dist-tag) |
| Exit RC  | `pnpm changeset pre exit`     | Commit the delete, merge; next Version Packages merge publishes `latest`  |

`pre enter` / `pre exit` do not bump or publish. Do not mix stable and RC packages in one
`changeset version`.

## Trusted publishing

Each public package must list this repo + workflow as a trusted publisher on npmjs.com:

- Repository: `truefoundry/trueforge`
- Workflow: `release.yml` (exact filename)
- No GitHub Environment name

Do not set `NPM_TOKEN` / `_authToken` on the publish job — that disables OIDC.
Only the **publish** job uses npm OIDC (`id-token: write`).

Publish attaches npm provenance (`NPM_CONFIG_PROVENANCE` on the publish job, and
`publishConfig.provenance: true` on every public package). That publicly attests
the source repo and commit on npmjs.com.

## Local without publishing

```bash
pnpm clean && pnpm build && pnpm standalone:start
# or: pnpm pack inside packages/trueforge-core / packages/trueforge
```

## Troubleshooting

- **No Version Packages PR** — no `.changeset/*.md` on `main`. Add one, or re-run **Release**.
- **Publish wants a tag** — RCs need the `rc` dist-tag (set automatically while `pre.json` exists).
- **403** — version already on npm, or trusted-publisher config mismatch.
- **OIDC fail** — pnpm >= 11.0.7; remove registry `_authToken`.
- **Missing `dist/_frontend/index.html`** — root `pnpm build` must build `frontend` first.
- **SDK not regenerated on Version PR** — only when `@truefoundry/trueforge-sdk` version moved
  (`scripts/version.mjs`; needs Docker).
- **Prod image missing after npm publish** — dispatch the chart workflow on a
  **branch or tag** (not a SHA): `gh workflow run build-and-prepare-chart-release.yml --ref main -f app_version=X.Y.Z -f update_app_version=true`.

---

# Image and Helm chart

```text
npm publish @truefoundry/trueforge@X.Y.Z
  → call build-and-prepare-chart-release (same commit as publish)
  → build Dockerfile (APP_VERSION=X.Y.Z) → push X.Y.Z-<shortSha>
  → open/update PR on branch release-chart/trueforge
  → merge PR → tag + GH Release + OCI push (release-chart.yml)

manual rebuild (same or other app version)
  → workflow_dispatch build-and-prepare-chart-release
  → same PR path

chart-only
  → human PR bumps Chart.yaml version
  → human tags charts/trueforge@A.B.C (or gh release create)
  → release-chart.yml publishes OCI (no image rebuild)
```

## Dockerfiles

| File                               | Role                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| [`Dockerfile`](Dockerfile)         | Prod/OSS. `ARG APP_VERSION` → `npm install @truefoundry/trueforge@$APP_VERSION`         |
| [`Dockerfile.dev`](Dockerfile.dev) | From-source. Used by [`docker-compose.yml`](docker-compose.yml) and **Build dev image** |

Prod fails if that npm version is missing (no workspace fallback), so `appVersion` stays honest
even when `main` has moved on.

## Build and prepare chart release

[`build-and-prepare-chart-release.yml`](.github/workflows/build-and-prepare-chart-release.yml)
(`workflow_call` from **Release**, or manual `workflow_dispatch`):

| Input                | Default                   | Meaning                                                              |
| -------------------- | ------------------------- | -------------------------------------------------------------------- |
| `app_version`        | `Chart.yaml` `appVersion` | npm version to install into the image                                |
| `update_app_version` | `false`                   | Also write that version into `Chart.yaml` `appVersion` on the bot PR |

Always: build/push `{appVersion}-{shortSha}`, patch-bump chart `version`, set `image.tag`,
open/update one PR on `release-chart/trueforge`.

```bash
gh workflow run build-and-prepare-chart-release.yml
gh workflow run build-and-prepare-chart-release.yml -f app_version=0.1.0
# after npm publish of a new app version:
gh workflow run build-and-prepare-chart-release.yml \
  -f app_version=0.1.0 -f update_app_version=true
```

You may edit chart SemVer (minor/major) on the PR before merging; the tag follows
`Chart.yaml` `version` at merge time. Each run rebuilds the `release-chart/trueforge` branch
from `main`, but a chart `version` on the branch that outranks the patch bump is carried over,
so a manual bump survives later image rebuilds. Other manual edits on that branch do not —
commit them to `main` instead.

## Publish Helm chart

[`release-chart.yml`](.github/workflows/release-chart.yml) is one job with three entry points:

| Trigger                                                   | What it does                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| Merged PR from `release-chart/trueforge` (same repo only) | Create `charts/trueforge@<version>` + GitHub Release, then OCI push |
| Push of tag `charts/trueforge@*`                          | OCI push only (tag already exists)                                  |
| `workflow_dispatch` with `tag=`                           | OCI push for an existing tag (retry)                                |

Only the `release-chart/trueforge` branch auto-tags. Ordinary merges never create chart tags.

Chart-only example:

```bash
# after merging a PR that bumped Chart.yaml version:
git tag charts/trueforge@0.1.0
git push origin charts/trueforge@0.1.0
```

## Dev / floating main

External deploy repo owns `truefoundry.yaml` (`git-helm-repo` @ `main`). Build a from-source image:

```bash
gh workflow run build-dev-image.yml --ref main
# → tfy.jfrog.io/tfy-images/trueforge:<fullSha>
```

Patch that SHA into `image.tag`. Secrets via `secretKeyRef` only — never plaintext in git.
Do not use SHA-tagged images as production chart defaults.

## Bundled chart dependencies

Optional Postgres/Redis Bitnami subcharts (`Chart.lock`). Publish runs `helm dependency build`.
Disable with `postgresql.enabled=false` / `redis.enabled=false`.

Subchart **images** are mirrored on JFrog (`values.yaml`). Mirror once per pin:

```bash
for img in \
  postgresql:17.6.0-debian-12-r4 \
  redis:8.2.1-debian-12-r0; do
  crane copy "docker.io/bitnamilegacy/${img}" "tfy.jfrog.io/tfy-mirror/bitnamilegacy/${img}"
done
```

To bump: edit `Chart.yaml` deps → `pnpm chart:deps` → update `values.yaml` image tags → mirror.

## Validate chart locally

```bash
pnpm chart:deps
pnpm chart:lint
pnpm chart:template
pnpm chart:package
```
