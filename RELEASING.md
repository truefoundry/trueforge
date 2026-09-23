# Releasing

This repo ships npm packages, a production container image, a Helm chart, a
sandbox image, and optional from-source **dev** images.

| What                    | Trigger                                                       | Workflow                                                             |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| npm packages            | Push to `main` (Changesets)                                   | [`release-packages.yml`](.github/workflows/release-packages.yml)     |
| PyPI `trueforge-sdk`    | Same `mode=publish` run as npm (parallel OIDC job)            | [`release-packages.yml`](.github/workflows/release-packages.yml)     |
| Prod image + Helm chart | Push of `chart/v*` tag from the package workflow, or dispatch | [`release-chart.yml`](.github/workflows/release-chart.yml)           |
| Sandbox image + pin PR  | Push to `main` when `scripts/sandbox/**` changes, or dispatch | [`push-sandbox-image.yml`](.github/workflows/push-sandbox-image.yml) |
| Dev (from-source) image | Manual `workflow_dispatch`                                    | [`build-dev-image.yml`](.github/workflows/build-dev-image.yml)       |
| PR checks               | Pull request / merge group                                    | [`ci.yml`](.github/workflows/ci.yml)                                 |

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
| Dev image                    | Same [`Dockerfile`](Dockerfile); tag = full commit SHA                                                    |

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

No `v*` GitHub tag on the Version Packages path. [`release-packages.yml`](.github/workflows/release-packages.yml)
is packages plus a chart tag (`select-mode` → `version` \| `pack` → npm + PyPI + `chart/v*`):

1. Add a changeset in the same PR as the code change (`pnpm changeset`, or
   `pnpm change --bump patch --summary "…" <pkg>`). SDK regen already adds
   `@truefoundry/trueforge-sdk` via `pnpm changeset:sdk-regen`.
2. Merge to `main`. Pending changesets → **Version Packages** PR
   (`pnpm run version`). When `@truefoundry/trueforge-sdk` moves,
   `scripts/version.mjs` mirrors that version into `python/trueforge_sdk` and
   regenerates both SDKs. Review and merge.
3. With no pending changesets, **pack** (build/test) and **Windows npx smoke**
   run in parallel, then **npm publish**, **PyPI publish**, and **Create release tag**
   (`chart/v<packages/trueforge version>`) run in parallel. PyPI skips when that
   `pyproject.toml` version is already published. The tag is pushed with the
   GitHub App token so it can start the image + Helm workflow.
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
- Workflow: `release-packages.yml` (exact filename)
- No GitHub Environment name

This filename used to be `release.yml`. Update every package on npmjs.com (and
PyPI below) before the first publish from this workflow, or OIDC will 403.

Do not set `NPM_TOKEN` / `_authToken` on the npm publish job - that disables OIDC.
Only the **publish** / **publish-python** jobs use OIDC (`id-token: write`).

Publish attaches npm provenance (`NPM_CONFIG_PROVENANCE` on the publish job, and
`publishConfig.provenance: true` on every public package). That publicly attests
the source repo and commit on npmjs.com.

**PyPI** `trueforge-sdk` uses the same workflow file via a trusted publisher:

- Repository: `truefoundry/trueforge`
- Workflow: `release-packages.yml` (exact filename)
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
- **403** - version already on npm, or trusted-publisher config mismatch (filename must be `release-packages.yml`).
- **OIDC fail** - pnpm >= 11.0.7; remove registry `_authToken`.
- **Missing `dist/_frontend/index.html`** - root `pnpm build` must build `frontend` first.
- **SDK not regenerated on Version PR** - only when `@truefoundry/trueforge-sdk` version moved
  (`scripts/version.mjs`; needs Docker). That path also mirrors the version into `python/trueforge_sdk`.
- **PyPI 403 / invalid-publisher** - register a trusted publisher for `trueforge-sdk` bound to
  `release-packages.yml` (and create the project if it does not exist yet).
- **Prod image / chart missing after package publish** - confirm `chart/v<version>` was
  pushed, or dispatch the chart workflow on a **branch or tag** (not a SHA):
  `gh workflow run release-chart.yml --ref main`.

---

# Image and Helm chart

```text
push to main (no pending changesets, unpublished versions)
  → release-packages.yml: pack + smoke
       → npm | PyPI | chart/v<packageVersion> tag  (parallel)
  → tag push starts release-chart.yml
       → build from-source Dockerfile → push X.Y.Z-<shortSha>
       → helm lint/package/push OCI
       → commit Chart.yaml + values.yaml to main

manual rebuild
  → workflow_dispatch release-chart.yml --ref main (or an existing chart/v* tag)
```

The package workflow pushes the tag with the GitHub App token. `GITHUB_TOKEN`
tag pushes do not start other workflows.

## Dockerfile

| File                       | Role                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`Dockerfile`](Dockerfile) | From-source. Prod Helm, [`docker-compose.yml`](docker-compose.yml), Railway, **Build SHA-tagged from-source image** |

The image is the workspace at the tagged commit. Chart `appVersion` is that
commit's `packages/trueforge/package.json` version. A `chart/v*` tag push fails
if the version after `chart/v` does not match that package version.

## Build server image and publish Helm chart

[`release-chart.yml`](.github/workflows/release-chart.yml) (`chart/v*` tag, or
`workflow_dispatch`).

| Input         | Default                           | Meaning                                                        |
| ------------- | --------------------------------- | -------------------------------------------------------------- |
| `app_version` | `packages/trueforge/package.json` | Used on dispatch; ignored when the trigger is a `chart/v*` tag |

Always: build/push `{appVersion}-{shortSha}`, set chart `version` to the app
major.minor (patch/RC may still advance), set `appVersion` and `image.tag`,
lint, package, push OCI, then commit those chart files to `main`.

```bash
gh workflow run release-chart.yml --ref main
gh workflow run release-chart.yml --ref main -f app_version=0.1.0
```

Chart major.minor is taken from [`scripts/resolve-chart-version.sh`](scripts/resolve-chart-version.sh)
so it matches `@truefoundry/trueforge` (and the docker tag prefix). Patch and RC
still advance per chart release.

## Dev / floating main

External deploy repo owns `truefoundry.yaml` (`git-helm-repo` @ `main`). Build a from-source image:

```bash
gh workflow run build-dev-image.yml --ref main
# → tfy.jfrog.io/tfy-images/trueforge:<fullSha>
```

Patch that SHA into `image.tag`. Secrets via `secretKeyRef` only - never plaintext in git.
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
