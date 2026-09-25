# Releasing

This repo ships npm packages, a production container image, a Helm chart, and a
sandbox image.

| What                   | Trigger                                                       | Workflow                                                             |
| ---------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| npm packages           | Push to `main` (Changesets)                                   | [`release.yml`](.github/workflows/release.yml)                       |
| PyPI `trueforge-sdk`   | Same `mode=publish` run as npm (parallel OIDC job)            | [`release.yml`](.github/workflows/release.yml)                       |
| Prod image             | Same `mode=publish` run as npm (after pack + smoke)           | [`release.yml`](.github/workflows/release.yml)                       |
| Helm chart             | Called from `release.yml` after the image, or manual dispatch | [`release-chart.yml`](.github/workflows/release-chart.yml)           |
| Sandbox image + pin PR | Push to `main` when `scripts/sandbox/**` changes, or dispatch | [`push-sandbox-image.yml`](.github/workflows/push-sandbox-image.yml) |
| PR checks              | Pull request / merge group                                    | [`ci.yml`](.github/workflows/ci.yml)                                 |

## Versioning

| Artifact                     | Identity                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| npm `@truefoundry/trueforge` | SemVer `X.Y.Z` - source of truth for published packages                                                   |
| PyPI `trueforge-sdk`         | Same SemVer as `@truefoundry/trueforge-sdk` (mirrored into `pyproject.toml` on Version Packages)          |
| Chart `appVersion`           | `packages/trueforge/package.json` version at the build commit                                             |
| Prod image                   | Root [`Dockerfile`](Dockerfile): from-source workspace build                                              |
| Prod image tag               | `{packageVersion}-{shortSha}`                                                                             |
| Chart `version`              | Same major.minor as `@truefoundry/trueforge`; patch/RC may still advance                                  |
| Sandbox image                | [`sandbox.Dockerfile`](packages/trueforge-core/scripts/sandbox/sandbox.Dockerfile); tag = full commit SHA |

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
| `@truefoundry/trueforge-sdk`  | `packages/trueforge-sdk`  | Fern-generated - do not hand-edit             |
| `@truefoundry/trueforge-ui`   | `packages/trueforge-ui`   | Embeddable chat UI                            |

`packages/frontend` is not published; its build is copied into `@truefoundry/trueforge`'s tarball.
`workspace:*` is rewritten to exact versions on publish.

## Flow

No extra GitHub tag on the Version Packages path. [`release.yml`](.github/workflows/release.yml)
is packages plus the from-source image (`select-mode` → `version` \| `pack` → npm + PyPI + image, then Helm):

1. Add a changeset in the same PR as the code change (`pnpm changeset`, or
   `pnpm change --bump patch --summary "…" <pkg>`). SDK regen already adds
   `@truefoundry/trueforge-sdk` via `pnpm changeset:sdk-regen`.
2. Merge to `main`. Pending changesets → **Version Packages** PR
   (`pnpm run version`). When `@truefoundry/trueforge-sdk` moves,
   `scripts/version.mjs` mirrors that version into `python/trueforge_sdk` and
   regenerates both SDKs. Review and merge.
3. With no pending changesets, **pack** (build/test) and **Windows npx smoke**
   run in parallel, then **npm publish**, **PyPI publish**, and **Build and push server image**
   run in parallel. PyPI skips when that `pyproject.toml` version is already
   published. After the image is pushed, this workflow calls
   [`release-chart.yml`](.github/workflows/release-chart.yml) with `branch=main`,
   `app_version`, and `image_tag`. Helm does not wait on npm.
4. Pin dependents to exact versions during early `0.x`.

`workflow_dispatch` on **Version or publish packages** re-runs the same workflow.

## Prerelease mode

Repo-wide via `.changeset/pre.json` (absent = publish to `latest`):

| Goal     | Command                       | Then                                                                      |
| -------- | ----------------------------- | ------------------------------------------------------------------------- |
| Enter RC | `pnpm changeset pre enter rc` | Commit `pre.json`, merge; versions look like `x.y.z-rc.N` (`rc` dist-tag) |
| Exit RC  | `pnpm changeset pre exit`     | Commit the delete, merge; next Version Packages merge publishes `latest`  |

`pre enter` / `pre exit` do not bump or publish. Do not mix stable and RC packages in one
`changeset version`.

## Trusted publishing

Each public **npm** package must list this repo + workflow as a trusted publisher on npmjs.com:

- Repository: `truefoundry/trueforge`
- Workflow: `release.yml` (exact filename)
- No GitHub Environment name

Do not rename this file without updating every package on npmjs.com (and PyPI
below), or OIDC will 403.

Do not set `NPM_TOKEN` / `_authToken` on the npm publish job - that disables OIDC.
Only the **publish** / **publish-python** jobs use npm/PyPI OIDC (`id-token: write`).
The image job also uses `id-token: write` for JFrog.

Publish attaches npm provenance (`NPM_CONFIG_PROVENANCE` on the publish job, and
`publishConfig.provenance: true` on every public package). That publicly attests
the source repo and commit on npmjs.com.

**PyPI** `trueforge-sdk` uses the same workflow file via a trusted publisher:

- Repository: `truefoundry/trueforge`
- Workflow: `release.yml` (exact filename)
- No Environment name (unless you add one to the job and mirror it on PyPI)
- Create the project once on PyPI (or publish the first version), then add the
  pending/trusted publisher before the first OIDC upload succeeds.
- Import and `pyproject.toml` name stay `trueforge_sdk` (what we upload); install with `pip install trueforge-sdk`.

## Local without publishing

```bash
pnpm clean && pnpm build && pnpm standalone:start
# or: pnpm pack inside packages/trueforge-core / packages/trueforge
```

## Troubleshooting

- **No Version Packages PR** - no `.changeset/*.md` on `main`. Add one, or re-run **Version or publish packages**.
- **Publish wants a tag** - RCs need the `rc` dist-tag (set automatically while `pre.json` exists).
- **403** - version already on npm, or trusted-publisher config mismatch (filename must be `release.yml`).
- **OIDC fail** - pnpm >= 11.0.7; remove registry `_authToken`.
- **Missing `dist/_frontend/index.html`** - root `pnpm build` must build `frontend` first.
- **SDK not regenerated on Version PR** - only when `@truefoundry/trueforge-sdk` version moved
  (`scripts/version.mjs`; needs Docker). That path also mirrors the version into `python/trueforge_sdk`.
- **PyPI 403 / invalid-publisher** - register a trusted publisher for `trueforge-sdk` bound to
  `release.yml` (and create the project if it does not exist yet).
- **Prod image / chart missing after package publish** - re-run **Version or publish packages**,
  or publish a chart for an image already in the registry:
  `gh workflow run release-chart.yml --ref main -f branch=main -f app_version=X.Y.Z -f image_tag=X.Y.Z-<sha>`.

---

# Image and Helm chart

```text
push to main (no pending changesets, unpublished versions)
  → release.yml: pack + smoke
       → npm | PyPI | build image X.Y.Z-<shortSha>  (parallel)
       → after image: call release-chart.yml (main, app_version, image_tag)
  → release-chart.yml
       → helm lint/package/push OCI
       → commit Chart.yaml + values.yaml to that branch
       → tag charts/trueforge@<chartVersion> on that commit

manual chart-only (image already in the registry)
  → workflow_dispatch release-chart.yml --ref main -f branch=main
```

## Dockerfile

| File                               | Role                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------- |
| [`Dockerfile`](Dockerfile)         | From-source. Prod Helm, [`docker-compose.yml`](docker-compose.yml), Railway |
| [`Dockerfile.npm`](Dockerfile.npm) | Previous npm-install image (`APP_VERSION` from the registry)                |

The image is the workspace at the package-publish commit. Chart `appVersion` is
that commit's `packages/trueforge/package.json` version. Image tags use the
peeled commit SHA (`git rev-parse HEAD`), not an annotated-tag object.

## Publish Helm chart

[`release.yml`](.github/workflows/release.yml) builds/pushes `{appVersion}-{shortSha}`
from the root [`Dockerfile`](Dockerfile), then calls
[`release-chart.yml`](.github/workflows/release-chart.yml) (`workflow_call`) with
`branch=main`, `app_version`, and `image_tag`. The chart workflow does not build images.

`--ref` selects which workflow file GitHub runs. `branch` is the git branch that
receives `Chart.yaml` / `values.yaml`.

| Input         | Default (manual dispatch only)                   | Meaning                                       |
| ------------- | ------------------------------------------------ | --------------------------------------------- |
| `branch`      | `main`                                           | Branch that receives the chart commit         |
| `app_version` | `packages/trueforge/package.json` on that branch | Written to Chart.yaml `appVersion`            |
| `image_tag`   | `{app_version}-{shortSha}` of that branch HEAD   | Existing registry tag; written to `image.tag` |

Always: replay chart `version` / `appVersion` / `image.tag` onto current
`origin/<branch>`, lint, package, push OCI (idempotent if that chart version is
already in the registry), commit those files to that branch, then tag
`charts/trueforge@<chartVersion>` on that commit. The commit is replayed onto
`origin/<branch>` if the branch moved.

```bash
gh workflow run release-chart.yml --ref main -f branch=main
gh workflow run release-chart.yml --ref main \
  -f branch=main \
  -f app_version=0.3.0-rc.0 \
  -f image_tag=0.3.0-rc.0-abcdef1
```

Chart major.minor is taken from [`scripts/resolve-chart-version.sh`](scripts/resolve-chart-version.sh)
so it matches `@truefoundry/trueforge` (and the docker tag prefix). Patch and RC
still advance per chart release.

## Devtest

[`deploy-devtest.yml`](.github/workflows/deploy-devtest.yml) pins the current
`main` SHA into `truefoundry/trueforge-devtest-deployment`. That environment
builds from source. Secrets via `secretKeyRef` only - never plaintext in git.

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
