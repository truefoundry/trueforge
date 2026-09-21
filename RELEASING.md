# Releasing

This repo ships npm packages, a production container image, a Helm chart, a
sandbox image, and optional from-source **dev** images.

| What                                | Trigger                                                                            | Workflow                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| npm packages                        | Push to `main` or `release-v*` (Changesets)                                        | [`release.yml`](.github/workflows/release.yml)                                                 |
| PyPI `trueforge-sdk`                | Same `mode=publish` run as npm (parallel OIDC job)                                 | [`release.yml`](.github/workflows/release.yml)                                                 |
| Prod image + chart-release PR       | After `@truefoundry/trueforge` npm publish (reusable workflow), or manual dispatch | [`build-and-prepare-chart-release.yml`](.github/workflows/build-and-prepare-chart-release.yml) |
| Chart tag, GitHub Release, OCI push | Auto-merge (or manual merge) of `release-chart/trueforge`, or tag/dispatch         | [`release-chart.yml`](.github/workflows/release-chart.yml)                                     |
| Sandbox image + pin PR              | Push to `main` when `scripts/sandbox/**` changes, or dispatch                      | [`push-sandbox-image.yml`](.github/workflows/push-sandbox-image.yml)                           |
| Dev (from-source) image             | Manual `workflow_dispatch`                                                         | [`build-dev-image.yml`](.github/workflows/build-dev-image.yml)                                 |

## Versioning

| Artifact                     | Identity                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| npm `@truefoundry/trueforge` | SemVer `X.Y.Z` — source of truth for app bits                                                             |
| PyPI `trueforge-sdk`         | Same SemVer as `@truefoundry/trueforge-sdk` (mirrored into `pyproject.toml` on Version Packages)          |
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
(`select-mode` → `version` \| `pack` → `publish`) on `main` and on `release-v*`:

1. Add a changeset in the same PR as the code change (`pnpm changeset`, or
   `pnpm change --bump patch --summary "…" <pkg>`). SDK regen already adds
   `@truefoundry/trueforge-sdk` via `pnpm changeset:sdk-regen`.
2. Merge to the release branch (`main` or `release-v*`). Pending changesets →
   **Version Packages** PR targeting that branch (`pnpm run version`). When
   `@truefoundry/trueforge-sdk` moves, `scripts/version.mjs` mirrors that version
   into `python/trueforge_sdk` and regenerates both SDKs. Review and merge.
3. With no pending changesets, **pack** (build/test) and **Windows npx smoke**
   run in parallel, then **npm publish** and **PyPI publish** run in parallel
   via trusted publishing (OIDC; no `NPM_TOKEN` / `PYPI_TOKEN`). PyPI skips when
   that `pyproject.toml` version is already published.
4. If `@truefoundry/trueforge` was published, **Release** calls **Build and
   prepare chart release** on the same commit: image build, chart bot PR, then
   (by default) wait for CI and squash-merge so OCI publish runs without a
   human merge. GitHub's `workflow_dispatch` API only accepts a branch or tag
   name, not a SHA.
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

Each public **npm** package must list this repo + workflow as a trusted publisher on npmjs.com:

- Repository: `truefoundry/trueforge`
- Workflow: `release.yml` (exact filename)
- No GitHub Environment name

Do not set `NPM_TOKEN` / `_authToken` on the npm publish job — that disables OIDC.
Only the **publish** / **publish-python** jobs use OIDC (`id-token: write`).

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

- **No Version Packages PR** — no `.changeset/*.md` on `main`. Add one, or re-run **Release**.
- **Publish wants a tag** — RCs need the `rc` dist-tag (set automatically while `pre.json` exists).
- **403** — version already on npm, or trusted-publisher config mismatch.
- **OIDC fail** — pnpm >= 11.0.7; remove registry `_authToken`.
- **Missing `dist/_frontend/index.html`** — root `pnpm build` must build `frontend` first.
- **SDK not regenerated on Version PR** — only when `@truefoundry/trueforge-sdk` version moved
  (`scripts/version.mjs`; needs Docker). That path also mirrors the version into `python/trueforge_sdk`.
- **PyPI 403 / invalid-publisher** — register a trusted publisher for `trueforge-sdk` bound to
  `release.yml` (and create the project if it does not exist yet).
- **Prod image missing after npm publish** — dispatch the chart workflow on a
  **branch or tag** (not a SHA): `gh workflow run build-and-prepare-chart-release.yml --ref main -f app_version=X.Y.Z -f update_app_version=true`.

---

# Image and Helm chart

```text
npm publish @truefoundry/trueforge@X.Y.Z
  → call build-and-prepare-chart-release (same commit as publish)
  → build Dockerfile (APP_VERSION=X.Y.Z) → push X.Y.Z-<shortSha>
  → open/update chart bot PR (release-chart/trueforge or release-chart/trueforge-release-v*)
  → wait for CI check → squash-merge (merge_chart_pr=true)
  → tag + GH Release + OCI push (release-chart.yml)

manual rebuild (inspect without merge)
  → workflow_dispatch build-and-prepare-chart-release (merge_chart_pr=false)
  → same PR path; merge by hand when ready

chart-only
  → human PR bumps Chart.yaml version
  → human tags charts/trueforge@A.B.C (or gh release create)
  → release-chart.yml publishes OCI (no image rebuild)
```

## Hotfix release branches

Cut a line from a shipped commit so a patch does not take tip-of-`main`:

```bash
git fetch origin
git checkout -b release-vX.Y.Z <shipped-sha>
# or from a chart tag:
# git checkout -b release-vX.Y.Z charts/trueforge@A.B.C
git push -u origin release-vX.Y.Z
```

Then cherry-pick the fix + changeset onto that branch, merge the Version Packages
PR that targets `release-vX.Y.Z`, and let **Release** publish npm/PyPI and auto
chart OCI (chart SemVer stays on that line: same `X.Y.Z-rc.*` or stable `X.Y.*`).
Pass the resulting chart SemVer to helm-charts `release-start` as
`trueforge_chart_version` (control-plane pin).

Org rules still require human approval on Version Packages PRs into `release-v*`.
Chart auto-merge needs the limited `trueforge-dev-bot` ruleset bypass
(`pull_request` mode; required CI checks on a no-bypass ruleset).

Smoke-test the first hotfix npm/PyPI publish: trusted publishers bind to
`release.yml` with no Environment name.

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

| Input                | Default                            | Meaning                                                              |
| -------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `app_version`        | `Chart.yaml` `appVersion`          | npm version to install into the image                                |
| `update_app_version` | `false`                            | Also write that version into `Chart.yaml` `appVersion` on the bot PR |
| `merge_chart_pr`     | `true` (call) / `false` (dispatch) | Wait for CI `check` and squash-merge the chart bot PR                |

Always: build/push `{appVersion}-{shortSha}`, patch-bump chart `version`, set `image.tag`,
open/update one PR on `release-chart/trueforge` (base `main`) or
`release-chart/trueforge-<release-v*>` (hotfix base). Chart version baseline is
`max(Chart.yaml, highest tag on the same line)`: same `X.Y.Z-rc.*` cycle stays
monotonic and the same-core stable `X.Y.Z` closes that RC line; a stable `X.Y.*`
hotfix ignores newer majors/RC lines (e.g. `0.2.0` → `0.2.1` while `main` is on
`0.3.0-rc.*`). Image builds may run per-ref in
parallel; chart version assign + PR open/merge is globally serialized with a
multi-run pending queue (`queue: max`), and auto-merge waits until the
`charts/trueforge@*` tag exists before the next run starts.

```bash
gh workflow run build-and-prepare-chart-release.yml
gh workflow run build-and-prepare-chart-release.yml -f app_version=0.1.0
# after npm publish of a new app version:
gh workflow run build-and-prepare-chart-release.yml \
  -f app_version=0.1.0 -f update_app_version=true
# inspect without auto-merge:
gh workflow run build-and-prepare-chart-release.yml -f merge_chart_pr=false
```

You may edit chart SemVer (minor/major) on the PR before merging; the tag follows
`Chart.yaml` `version` at merge time. Each run rebuilds the `release-chart/trueforge` branch
from the chart base, but a chart `version` on the branch that outranks the patch bump is carried over,
so a manual bump survives later image rebuilds. Other manual edits on that branch do not —
commit them to the base branch instead.

## Publish Helm chart

[`release-chart.yml`](.github/workflows/release-chart.yml) is one job with three entry points:

| Trigger                                                                                            | What it does                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Merged PR from `release-chart/trueforge` or `release-chart/trueforge-*` into `main` / `release-v*` | Create `charts/trueforge@<version>` + GitHub Release, then OCI push |
| Push of tag `charts/trueforge@*`                                                                   | OCI push only (tag already exists)                                  |
| `workflow_dispatch` with `tag=`                                                                    | OCI push for an existing tag (retry)                                |

Only `release-chart/trueforge` (main) and `release-chart/trueforge-*` (hotfix)
heads auto-tag. Ordinary merges never create chart tags.

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
