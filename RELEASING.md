# Releasing

This repo ships npm packages, a production container image, a Helm chart, and a
sandbox image.

| What                   | Trigger                                                                                                 | Workflow                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| npm packages           | `workflow_dispatch` from the parent chart release, on `release-vX.Y.Z`. `main` collects changesets only | [`release.yml`](.github/workflows/release.yml)                       |
| PyPI `trueforge-sdk`   | Same run as npm (parallel OIDC job)                                                                     | [`release.yml`](.github/workflows/release.yml)                       |
| Prod image             | Same run as npm; independent of pack + smoke                                                            | [`release.yml`](.github/workflows/release.yml)                       |
| Helm chart             | Called from `release.yml` after the images, or manual dispatch                                          | [`release-chart.yml`](.github/workflows/release-chart.yml)           |
| Sandbox image + pin PR | Push to `main` when `scripts/sandbox/**` changes, or dispatch                                           | [`push-sandbox-image.yml`](.github/workflows/push-sandbox-image.yml) |
| PR checks              | Pull request / merge group                                                                              | [`ci.yml`](.github/workflows/ci.yml)                                 |

## Versioning

| Artifact                     | Identity                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| npm `@truefoundry/trueforge` | SemVer `X.Y.Z` - source of truth for published packages                                                   |
| PyPI `trueforge-sdk`         | Same SemVer as `@truefoundry/trueforge-sdk` (mirrored into `pyproject.toml` on Version Packages)          |
| Chart `appVersion`           | `packages/trueforge/package.json` version at the build commit                                             |
| Prod image                   | Root [`Dockerfile`](Dockerfile): from-source workspace build                                              |
| Prod image tag               | `{packageVersion}-{shortSha}`                                                                             |
| Chart `version`              | The dispatching chart version, verbatim (`tfy_chart_version`). Nothing in this repo computes it           |
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

[`release.yml`](.github/workflows/release.yml) is packages plus the from-source
images and the chart. It runs on `release-vX.Y.Z`. `main` collects changesets and
does not publish.

1. Add a changeset in the same PR as the code change (`pnpm changeset`, or
   `pnpm change --bump patch --summary "…" <pkg>`). SDK regen already adds
   `@truefoundry/trueforge-sdk` via `pnpm changeset:sdk-regen`.
2. Merge to `main`.
3. A parent chart release of `V` (`X.Y.Z` or `X.Y.Z-rc.N`) creates
   `release-vX.Y.Z` in this repo (`X.Y.Z` is `V` with any `-rc.N` removed) and
   dispatches this workflow with `tfy_chart_version=V`. The first cut of a minor
   line is from `main`; a hotfix line is cut from `refs/tags/v<base>` so
   unreleased work on `main` cannot enter a patch. An existing branch is kept as
   is and **never** has `main` merged into it: only the **first** RC of a minor
   line fails when `main` has commits the branch is missing, because from `rc.2`
   onward the branch legitimately carries version and changeset commits `main`
   lacks and the comparison would always read `diverged`. A hotfix line is
   supposed to lag `main`.
4. That dispatch runs `scripts/prepare-release.mjs`, then `pnpm run version`, and
   commits the result **directly** to `release-vX.Y.Z`. Pre mode follows `V`
   (`rc` enters, a stable version exits). Published packages still at `0.0.0`
   become `X.Y.0` or `X.Y.0-rc.0`. `packages/frontend` stays `0.0.0`. When
   `@truefoundry/trueforge-sdk` moves, `scripts/version.mjs` mirrors that version
   into `python/trueforge_sdk` and regenerates both SDKs. There is no Version
   Packages PR: one dispatch, one run, one conclusion.
5. The same run then does everything else, checking out the commit from step 4:
   - **pack** (build/test) and **Windows npx smoke** gate **npm** and **PyPI**.
     They run only when `changesets/action/select-mode` reports `publish`; a line
     with no changesets since the last release reports `none`, which is normal.
   - **Resolve image identity** reads `packages/trueforge/package.json` for
     `appVersion` and checks whether `charts/trueforge@V` already exists. If not,
     both server images build as `{appVersion}-{shortSha}` and
     [`release-chart.yml`](.github/workflows/release-chart.yml) publishes the
     chart at exactly `V`. If the tag does exist, this is a re-run: the images
     are reused and the chart job finishes whatever the previous attempt left
     undone. This path never consults npm.
6. A **final minor** (`X.Y.0`, no `-rc.`) then opens and merges a back-merge PR
   into `main` that deletes the `.changeset/*.md` this line consumed and copies
   its `packages/*/CHANGELOG.md` across. No version field moves: `main` stays at
   `0.0.0`. RCs and hotfixes do not back-merge.

## Prerelease mode

Repo-wide via `.changeset/pre.json` (absent = publish to `latest`):

| Goal     | Command                       | Then                                                                      |
| -------- | ----------------------------- | ------------------------------------------------------------------------- |
| Enter RC | `pnpm changeset pre enter rc` | Commit `pre.json`, merge; versions look like `x.y.z-rc.N` (`rc` dist-tag) |
| Exit RC  | `pnpm changeset pre exit`     | Commit the delete, merge; the next release publishes `latest`             |

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

- **Nothing was versioned** - no `.changeset/*.md` on the release branch. That is not an error: the chart still publishes at `tfy_chart_version`. Add changesets on `main` before the next line is cut.
- **Publish wants a tag** - RCs need the `rc` dist-tag (set automatically while `pre.json` exists).
- **403** - version already on npm, or trusted-publisher config mismatch (filename must be `release.yml`).
- **OIDC fail** - pnpm >= 11.0.7; remove registry `_authToken`.
- **Missing `dist/_frontend/index.html`** - root `pnpm build` must build `frontend` first.
- **SDK not regenerated** - only when `@truefoundry/trueforge-sdk` version moved
  (`scripts/version.mjs`; needs Docker). That path also mirrors the version into `python/trueforge_sdk`.
- **PyPI 403 / invalid-publisher** - register a trusted publisher for `trueforge-sdk` bound to
  `release.yml` (and create the project if it does not exist yet).
- **Prod image / chart missing after package publish** - re-run **Version or publish packages**
  on the release branch with the same `tfy_chart_version` (every step is idempotent), or
  publish a chart for an image already in the registry:
  `gh workflow run release-chart.yml --ref release-vX.Y.Z -f branch=release-vX.Y.Z -f chart_version=X.Y.Z -f app_version=X.Y.Z -f image_tag=X.Y.Z-<sha>`.

---

# Image and Helm chart

```text
parent chart release V
  → branch release-vX.Y.Z (from main for a new minor; from
    refs/tags/v<base> for a hotfix; fail only on the FIRST rc if an existing
    minor branch is missing commits from main)
  → workflow_dispatch release.yml --ref release-vX.Y.Z -f tfy_chart_version=V
       → prepare pre mode + 0.0.0 bootstrap
       → changeset version, commit straight to release-vX.Y.Z
       → select-mode: publish | none
       → (publish) pack + smoke → npm | PyPI
       → resolve image identity; charts/trueforge@V missing?
            yes → build both images X.Y.Z-<shortSha>
            no  → re-run: reuse the tagged commit's image
       → release-chart.yml (branch, chart_version=V, app_version, image_tag)
            → helm lint / package
            → commit Chart.yaml + values.yaml to that branch (skip if unchanged)
            → tag charts/trueforge@V (annotated) + vV (lightweight) on that
              commit (no-op if already present at the same sha)
            → helm push OCI (skip if V is already in the registry)
       → (V is X.Y.0 and not an rc) back-merge PR into main:
            delete the consumed .changeset/*.md, take packages/*/CHANGELOG.md

manual chart-only (image already in the registry)
  → workflow_dispatch release-chart.yml --ref <release-branch>
     -f branch=<release-branch> -f chart_version=X.Y.Z
     (empty app_version / image_tag keep Chart.yaml / values.yaml)
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
`branch` set to the `release-vX.Y.Z` branch the workflow is running on,
`chart_version`, `app_version`, and `image_tag`. The chart workflow does not
build images.

`--ref` selects which workflow file GitHub runs. `branch` is the git branch that
receives `Chart.yaml` / `values.yaml`.

| Input           | Default (manual dispatch only)           | Meaning                                       |
| --------------- | ---------------------------------------- | --------------------------------------------- |
| `branch`        | `main`                                   | Branch that receives the chart commit         |
| `chart_version` | none - required                          | Written verbatim to Chart.yaml `version`      |
| `app_version`   | `Chart.yaml` `appVersion` on that branch | Written to Chart.yaml `appVersion`            |
| `image_tag`     | `values.yaml` `image.tag` on that branch | Existing registry tag; written to `image.tag` |

Always, in this order: write chart `version` / `appVersion` / `image.tag` onto
current `origin/<branch>`, lint, package, check the registry, commit those files
to that branch, tag `charts/trueforge@<chartVersion>` on that commit, then push
to OCI. The commit is replayed onto `origin/<branch>` if the branch moved. Every
step is idempotent: an unchanged metadata diff skips the commit, the tag already
on that commit is a no-op, and a chart version already in the registry skips the
push. The one hard failure is the tag existing on a _different_ commit - the same
chart version cannot ship two different contents.

```bash
gh workflow run release-chart.yml --ref main -f branch=main -f chart_version=0.3.1
gh workflow run release-chart.yml --ref main \
  -f branch=main \
  -f chart_version=0.3.0-rc.0 \
  -f app_version=0.3.0-rc.0 \
  -f image_tag=0.3.0-rc.0-abcdef1
```

The chart version is the `chart_version` input, verbatim - the same value as the
parent chart release that dispatched it. Nothing in this repo derives it, so
`oci://tfy.jfrog.io/tfy-helm/trueforge:<V>` and `charts/trueforge@<V>` are known
before the release starts. `appVersion` tracks `@truefoundry/trueforge` and the
image tag prefix; those are separate fields with separate owners.

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
