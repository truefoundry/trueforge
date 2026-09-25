# Kubernetes Sandbox Provider — Implementation Context

Living summary of where this work stands. Companion to `plan.md` (the original research/plan
doc, left as-is). Update this file as work progresses; it's the fast way back into the state of
things after a context reset or handoff.

**Note on authorship:** the bulk of PR 2 (schema/config/registration, `AgentSandboxBackend`, the
NATS host resolver, the reaper, the contract-test wiring, the changeset) was done in this same
worktree by work this session did not perform directly — it appeared between one turn and the
next, including an in-place edit of this session's own `KubernetesSandboxProvider.ts`. This
version of `context.md` was written after reviewing that work fresh: reading every new/changed
file in full, diffing every modified one, and running full verification. Treat the "Done and
verified" table below as independently checked, not merely reported.

## Status: PR 2 substantially complete and verified, including the self-host gating fix; PR 1 scoped down; nothing committed yet

Nothing has been committed to git. All work described below is unstaged in the worktree.

## ✅ Fixed: the Kubernetes provider was unreachable outside full TrueFoundry mode

**Root cause (found and confirmed by reading the call chain):**
`resolveTrueFoundrySandboxProviderConfig()` — the only code path that reads
`TRUEFOUNDRY_SANDBOX_PROVIDER=kubernetes` and any `KUBERNETES_SANDBOX_*` env var — was called
exclusively from `TrueFoundrySandboxProviderStore`, and `main.ts`'s
`buildResolveSandboxProviderStore` only ever constructed that store when
`isTrueFoundryModeEnabled(configuration)` was true, which requires
`TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` (a live TrueFoundry control-plane connection). A pure
self-hoster — the entire premise of issue #817 — had no path to the Kubernetes provider, even
following `docs/sandbox.mdx`'s own env example exactly (which never mentioned the SFY URL).

**Fix:** added `isEnvSandboxProviderEnabled()` to `config.ts` (same style/placement as
`isTrueFoundryModeEnabled`/`isOidcConfigured`): `!config.STANDALONE &&
config.TRUEFOUNDRY_SANDBOX_ENABLED` — true in full TrueFoundry mode _or_ in a self-hosted
distributed deployment that opts in via `TRUEFOUNDRY_SANDBOX_ENABLED` without any TrueFoundry
control-plane connection. Two call sites updated to use it:

1. `main.ts`'s `buildResolveSandboxProviderStore` now selects `TrueFoundrySandboxProviderStore`
   on `isTrueFoundryModeEnabled(configuration) || isEnvSandboxProviderEnabled(configuration)` —
   a pure widening (OR), so every existing TF-mode code path is unchanged.
2. `config.ts`'s top-level boot validation (the "Shared sandbox" block: provider/settings
   required, JSON well-formed, provider-specific credential checks) was split out of the
   TF-mode-only `if` — it previously never ran at all in self-host mode, so malformed
   `KUBERNETES_SANDBOX_*`/`TRUEFOUNDRY_SANDBOX_*` env vars would have silently done nothing at
   boot and only surfaced (partially) per-request. It now runs under
   `isEnvSandboxProviderEnabled(configuration)`, covering both modes. The genuinely TF-mode-only
   checks (OIDC-conflict, `TRUEFOUNDRY_API_KEY` required) stayed under `isTrueFoundryModeEnabled`
   — untouched, since those really are meaningless without an SFY connection.

**Verified, not just asserted:**

- 3 new unit tests for `isEnvSandboxProviderEnabled` (`config.test.ts`), TDD (RED confirmed —
  `TypeError: isEnvSandboxProviderEnabled is not a function` — before implementing).
- Real module-level checks against the actual `config.ts` (crafted env vars, fresh `tsx` import
  each time, not mocked):
  - `STANDALONE=false` + `TRUEFOUNDRY_SANDBOX_ENABLED=true` + `TRUEFOUNDRY_SANDBOX_PROVIDER=kubernetes`,
    **no** `TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` → import succeeds,
    `isEnvSandboxProviderEnabled() === true`, `isTrueFoundryModeEnabled() === false`. This is
    exactly the self-host scenario that was broken.
  - Same, with malformed `TRUEFOUNDRY_SANDBOX_SETTINGS` (`'{not-json'`) → now throws
    `TRUEFOUNDRY_SANDBOX_SETTINGS must be valid JSON` at import (previously silent).
  - Same, `TRUEFOUNDRY_SANDBOX_PROVIDER=daytona` with no settings → now throws
    (`TRUEFOUNDRY_SANDBOX_SETTINGS is not set`) at import (previously silent).
  - **Regression check:** plain self-host with no `TRUEFOUNDRY_SANDBOX_*` vars at all → import
    succeeds, `isEnvSandboxProviderEnabled() === false` — the existing Daytona-via-Settings-UI
    self-host flow (DB-backed `persistenceStore`) is provably unaffected.
- Full suite: `tsc --noEmit` clean (src + tests/unit), `eslint` clean, `prettier --check` clean,
  **72 suites / 656 tests / 656 passed** (was 653 before this fix — 3 new tests, zero
  regressions).

`docs/sandbox.mdx`'s existing env example now works exactly as written — no doc changes needed.

Below this point, "Done and verified" describes what runs correctly, and (as of this fix) is
also reachable end-to-end from a standalone/self-hosted deployment via
`TRUEFOUNDRY_SANDBOX_ENABLED=true` + `TRUEFOUNDRY_SANDBOX_PROVIDER=kubernetes`.

## Plan deviation agreed with the user

**PR 1 (multi-provider genericity) is descoped from plan.md.** The UI-adapter change plan.md
proposed can't ship from a fork PR: `packages/trueforge-ui` types against the _generated_ SDK
(`TrueForgeApi.SandboxProviderManifest`, currently Daytona-only), and
`.github/workflows/generate-sdk.yaml` explicitly skips OpenAPI/SDK commits on forks while
AGENTS.md forbids hand-editing generated output. Decision (user-approved): Kubernetes joins
`StoredSandboxProviderManifestSchema` as an **env-synthesized** provider, same precedent as
`TrueFoundrySandboxProviderSchema` — store/runtime only, never touches
`SandboxProviderManifestSchema` (OpenAPI), `CatalogSandboxProviderSchema`, the SDK, or the UI
adapter. Cost: no settings-UI story for Kubernetes until a follow-up PR lands after `main`
regenerates the SDK. **This part is now implemented** (see table below) — consistent with the
descope: no OpenAPI/SDK/catalog/UI files touched anywhere in the diff.

## Verification (re-run fresh during this review, not carried over from memory)

- `packages/trueforge-core`: `tsc --noEmit` clean; `jest` — **49 suites / 464 passed, 1 skipped
  (pre-existing, unrelated) / 465 total**.
- `packages/trueforge`: `tsc --noEmit` clean on both `src` and `tests/unit`; `jest` (full unit
  config) — **72 suites / 656 passed / 656 total** (includes the 3 new `isEnvSandboxProviderEnabled`
  tests from the self-host gating fix below).
- `eslint` clean on `packages/trueforge/src` and `packages/trueforge-core/src`.
  `packages/trueforge/tests` was also run and reported clean, but that check is vacuous for
  `*.test.ts` files — `eslint.config.mjs` globally ignores `**/*.test.ts` by repo policy (test
  files aren't part of the type-aware ESLint project). Only `prettier` and `tsc` (except
  `*.contract.test.ts`, excluded from `tests/unit/tsconfig.json`) actually check test files. See
  the correction note under "Findings from this review" below.
- `prettier --check` clean on every changed/new file (source, tests, configs, the changeset,
  this file, `plan.md`).
- No regressions: nothing outside the sandbox/config/provider-registration surface broke.

## Done and verified

| File                                                                                                                                                                                                                                                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/sandbox.mdx`, `docs/quickstart.mdx`, `packages/trueforge/.env.example`                                                                                                                                                                                         | Documented environment-only Kubernetes setup, resource precedence, required Kubernetes permissions, Agent Sandbox versus Pod fallback, kind-based contract testing, and cleanup. The UI/API remain Daytona-only by design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/trueforge/package.json`                                                                                                                                                                                                                                    | `@kubernetes/client-node ^2.0.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/sandbox/kubernetes/core/kubeExec.ts`                                                                                                                                                                                                                            | `pods/exec` transport: buffered binary-safe stdout/stderr, exit code parsed from the `NonZeroExitCode` status cause, stdin streaming, hard timeout that closes the socket. `toPodExecClient()` adapts client-node's `Exec` class onto the `PodExecClient` port. (Minor comment-style fix since first written: dropped `{@link …}` cross-links per this repo's comment convention.)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/sandbox/kubernetes/core/podExecCommand.ts`                                                                                                                                                                                                                      | `buildPodExecArgv()` — pods/exec has no `cwd`/`env` fields (unlike TFY's JSON protocol), so per-call cwd/env are composed into a `sh -c` script. Pure, unit-tested in isolation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/sandbox/kubernetes/backend/SandboxBackend.ts`                                                                                                                                                                                                                   | `SandboxBackend` port. `SandboxListEntry` now also carries an optional `tenantId` (read from the `SANDBOX_TENANT_ANNOTATION`), needed so the reaper can scope deletions to one tenant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/sandbox/kubernetes/backend/PodBackend.ts`                                                                                                                                                                                                                       | Raw-Pod `SandboxBackend`: labelled pod with a writable `emptyDir` mounted over the image `WORKDIR` (not a PVC — see ruling below), polls to Ready failing loudly on `ImagePullBackOff`/terminal phases, maps a missing/evicted pod to `SandboxNotAvailableError`, lists via the shared label selector (now also surfacing `tenantId` per entry).                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/sandbox/kubernetes/backend/AgentSandboxBackend.ts` **(new)**                                                                                                                                                                                                    | `SandboxBackend` backed by the `sandbox.x-k8s.io` / `agents.x-k8s.io` `Sandbox` CR (`agents.x-k8s.io/v1beta1`, plural `sandboxes`). Builds a CR body with a `podTemplate` mirroring `PodBackend`'s pod spec, polls the CR's own `Ready` condition _and_ the pod's readiness together, same `SandboxNotAvailableError`/cause-preservation discipline as `PodBackend`. No `as T` casts — uses `isRecord`/typeof narrowing throughout to read untyped CR JSON.                                                                                                                                                                                                                                                                                                                                                   |
| `src/sandbox/kubernetes/core/natsHostUrl.ts` **(new)**                                                                                                                                                                                                               | `KubernetesNatsHostUrlResolver` — the plan's "only novel piece, main risk". In-cluster: direct `ws://<podIp>:4444`. Out-of-cluster: opens a local TCP listener per pod (cached by `namespace/podName/podIp`), and for each incoming connection spins up a fresh client-node `PortForward` to the pod, piping bytes both ways — the same mechanism `kubectl port-forward` itself uses. Has a `close()` to tear down listeners — **see Finding 1, it's never called**.                                                                                                                                                                                                                                                                                                                                          |
| `src/sandbox/kubernetes/core/reaper.ts` **(new)**                                                                                                                                                                                                                    | `KubernetesSandboxReaper.reap()` — lists via the backend, deletes entries older than a TTL and owned by the current tenant, best-effort (a single delete failure is logged and skipped, doesn't abort the sweep). Wired into `KubernetesSandboxProvider.createSandbox()`, run-before-create (errors swallowed) — see Finding 2 on the latency this couples in.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/sandbox/kubernetes/provider/KubernetesSandboxProvider.ts`                                                                                                                                                                                                       | The `SandboxProvider` implementation: static-ready `buildImage`/`getImageBuildStatus` (now reporting `metadata: { backend: this.backend.kind }`, satisfying plan.md's "surface the backend choice" ask), `createSandbox` (reap, then create + wait-until-running), `exec` (layout-probed-and-cached PATH/PYTHONPATH absolutization, mirrors TFY), `uploadFile`/`downloadFile` (raw binary via `kubeExec`, no base64 — ruling below), cwd-relative layout getters, `createCodeModeTransport` wired to the injected `NatsHostUrlResolver`. **Fixed since first written:** the `JSON.parse(...) as StatResult` unsound assertion (a real AGENTS.md violation — "no `as T` escapes") was replaced with `parseStatResult()`, which validates the shape at runtime and throws a real error on a malformed response. |
| `src/sandbox/kubernetes/createKubernetesSandboxProvider.ts` **(new)**                                                                                                                                                                                                | Top-level wiring: builds a `KubeConfig` (`loadFromDefault()`), detects the Agent Sandbox CRD once via `ApiextensionsV1Api.readCustomResourceDefinition` (404 → `PodBackend` fallback, anything else → `AgentSandboxBackend`), constructs the `Exec`/`CoreV1Api`/`CustomObjectsApi` clients and the `KubernetesNatsHostUrlResolver`, returns the assembled `KubernetesSandboxProvider`. Resolves the `KubernetesSandboxProvider` (class) vs. `KubernetesSandboxProvider` (schema type) name collision cleanly via import aliasing (`as KubernetesManifest` / `as KubernetesProvider`).                                                                                                                                                                                                                         |
| `src/sandbox/kubernetes/core/memoizeByKey.ts` (new, added this pass)                                                                                                                                                                                                 | Generic per-key async memoization with in-flight dedup and eviction-on-rejection. `createKubernetesSandboxProvider` is the only consumer, but the utility itself has no Kubernetes-specific knowledge — see "Findings" below for why it was needed, not just an optimization.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/schemas/sandboxProvider.ts`                                                                                                                                                                                                                                     | `KubernetesSandboxProviderSchema` (env-synthesized: `type`, `namespace`, optional `service_account_name`/`image_pull_secret_name`/`resources`, `exec_timeout_ms` — no API key) added to `StoredSandboxProviderManifestSchema` only. `KubernetesSandboxResourcesSchema` (requests/limits string maps) factored out as its own named schema, shared between the store manifest and the env-settings schema below. `SandboxProviderManifestSchema` (OpenAPI) is untouched.                                                                                                                                                                                                                                                                                                                                       |
| `src/sandbox/providerUtils.ts`                                                                                                                                                                                                                                       | `toSandboxProviderFromRecord` is now `async` (Daytona/TFY branches wrapped in `Promise.resolve(...)`, all three call sites updated — see `sessionResources.ts` below) with a `case 'kubernetes':` that throws in `STANDALONE` mode (Kubernetes is distributed-only) and otherwise calls `createKubernetesSandboxProvider`. `checkSnapshotStatus` now short-circuits for `'truefoundry' \| 'kubernetes'` (both prebuilt-image, no snapshot refresh), mirroring the existing `truefoundry` branch exactly as plan.md asked.                                                                                                                                                                                                                                                                                     |
| `src/runtime/sessionResources.ts`                                                                                                                                                                                                                                    | `return toSandboxProviderFromRecord(...)` → `return await toSandboxProviderFromRecord(...)`, updated for the new async signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/truefoundry/resolveTrueFoundrySandboxProviderConfig.ts`                                                                                                                                                                                                         | New `'kubernetes'` variant on `TrueFoundrySandboxProviderConfig`; `KubernetesSandboxSettingsSchema` (currently just `resources`) parsed from `TRUEFOUNDRY_SANDBOX_SETTINGS` JSON, merged with `KUBERNETES_SANDBOX_RESOURCES` env (env takes precedence when both are set — **see Finding 3**, undocumented precedence between two resource-config paths). `TRUEFOUNDRY_SANDBOX_SETTINGS` is now optional when the provider is `'kubernetes'` (defaults to `'{}'`) — Kubernetes has no required JSON settings blob, unlike Daytona/TFY.                                                                                                                                                                                                                                                                        |
| `src/truefoundry/TrueFoundrySandboxProviderStore.ts`                                                                                                                                                                                                                 | `synthesizeKubernetesRecord()` — same shape as `synthesizeDaytonaRecord`/`synthesizeTrueFoundryRecord`, `status: 'ready'` always (matches `checkSnapshotStatus`'s short-circuit above).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/config.ts`                                                                                                                                                                                                                                                      | `TRUEFOUNDRY_SANDBOX_PROVIDER` widened to include `'kubernetes'`; eight new `KUBERNETES_SANDBOX_*` config fields (`NAMESPACE` default `'default'`, `SERVICE_ACCOUNT_NAME`, `IMAGE_PULL_SECRET_NAME`, `RESOURCES` raw JSON, `EXEC_TIMEOUT_MS` default 60s, `POLL_INTERVAL_MS` default 1s, `CREATE_TIMEOUT_MS` default 120s, `REAPER_TTL_MS` default 24h, `IN_CLUSTER` defaulting to `KUBERNETES_SERVICE_HOST !== undefined` — the standard in-cluster indicator, itself read via `getEnv`, not raw `process.env`, per this file's own rule). `TRUEFOUNDRY_SANDBOX_SETTINGS`'s required-when-enabled check now excludes the `kubernetes` provider.                                                                                                                                                              |
| `src/config.ts` (this session's addition)                                                                                                                                                                                                                            | New exported `isEnvSandboxProviderEnabled()` predicate; the "Shared sandbox" boot-validation block split out of the TrueFoundry-mode-only `if` to run under this broader predicate instead — see "Fixed" section above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/main.ts` (this session)                                                                                                                                                                                                                                         | `buildResolveSandboxProviderStore` widened to `isTrueFoundryModeEnabled(configuration) \|\| isEnvSandboxProviderEnabled(configuration)` — the actual fix that lets a self-hosted distributed deployment reach `TrueFoundrySandboxProviderStore` (and therefore the Kubernetes provider) without a TrueFoundry control-plane connection. Pure widening; TrueFoundry-mode behavior unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/trueforge/jest.kubernetes-sandbox.contract.config.cjs` **(new)** + `tests/unit/sandbox/kubernetes/provider/provider.contract.test.ts` **(new)** + `test:kubernetes-sandbox:contract` in both `packages/trueforge/package.json` and the root `package.json` | Mirrors the Local contract-test wiring exactly (same config shape, same `testMatch` pattern, same root-script forwarding). No CI job added — matches how `test:local-sandbox:contract` is wired today (CI never runs it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/trueforge-core/src/core/index.ts`                                                                                                                                                                                                                          | Exported `CodeModeNatsTransport`, `DEFAULT_SANDBOX_NATS_WS_PORT`, `withMcpClientOnPath` — previously TFY-private internals, needed for `KubernetesSandboxProvider` to compose the same NATS transport and PATH convention. Confirmed no ownership ambiguity (`LocalSandboxProvider` uses an entirely different SRT-based exec substrate, not this PATH-prepending convention).                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `.changeset/quiet-k8s-sandboxes.md` **(new)**                                                                                                                                                                                                                        | `@truefoundry/trueforge: minor`, `@truefoundry/trueforge-core: patch` — correct package names, correct bump types (additive feature / additive non-breaking export).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Test counts in `sandbox/kubernetes`: `kubeExec` 10, `PodBackend` 13, `podExecCommand` 10,
`KubernetesSandboxProvider` 19, `KubernetesSandboxReaper` 2, `AgentSandboxBackend` 13 (added in a
later pass this session — see "Fixed: AgentSandboxBackend had no storage configuration" below) —
74 suites / 677 tests in the full `packages/trueforge` run as of the latest root-level CI check
(the `memoizeByKey` fix below added one more file / 8 more tests after this line was written).
`natsHostUrl`/`createKubernetesSandboxProvider` still have no dedicated unit test files — see
Remaining work.

## Findings from this review (non-blocking, worth a follow-up)

1. ~~`KubernetesNatsHostUrlResolver.close()` is never called from any non-test source~~ **Fixed —
   and it turned out to be a bigger issue than a missing `close()` call.** Investigating this
   found that `createKubernetesSandboxProvider` was being rebuilt from scratch on _every_ call —
   including a real Kubernetes API request (the CRD detection) — even though
   `sessionResources.ts`'s `resolveSandboxProvider()` (called from `turns.ts` on every turn)
   is explicitly documented as "Builds a fresh provider client per call (**no network I/O**)".
   So the port-forward listener leak wasn't "one per pod for the process lifetime" as first
   described — it was **one new listener per turn, forever**, and every turn also paid a real
   K8s API round trip it shouldn't have. Fixed at the root: added a generic, fully unit-tested
   `memoizeByKey()` primitive (`core/memoizeByKey.ts`, 8 tests, including a concurrent-call
   dedup case so many simultaneous turns before the first CRD check resolves don't each trigger
   their own) and cached the whole built provider per tenant in `createKubernetesSandboxProvider`.
   This fixes three things at once: no more per-call K8s API request, no more per-call listener
   leak (bounded by distinct tenants now, not distinct turns), and — a bonus — the layout-caching
   optimization already inside `KubernetesSandboxProvider` (probes `pwd`/`$PATH` once per
   sandbox) now actually works across turns instead of starting from an empty `Map` every time,
   since it's the _same_ provider instance being reused. TDD: a mutation test on the eviction
   guard's `if (cache.get(key) === attempt)` check proved that condition was dead code (there's
   no way for two attempts to coexist for one key given the closed API) — removed it rather than
   keep untested defensive code, then verified the simplified version still fails 2/8 tests when
   eviction itself is mutated away, confirming real coverage. Full suite re-verified after:
   **74 suites / 677 tests**, all 5 root CI commands clean.
2. **`createSandbox()` runs the reaper (a full `backend.list()` + potentially many deletes)
   synchronously before every single sandbox creation**, coupling reap latency to the create
   path rather than running it as a decoupled background sweep. Functionally correct (errors are
   swallowed, so a slow/failing reap doesn't block creation forever), but adds avoidable latency
   as the sandbox count grows. A scheduled/interval-based sweep would decouple this, at the cost
   of needing a scheduler — reasonable to defer.
3. **Two independent, undocumented paths can set Kubernetes resource requests/limits**:
   `TRUEFOUNDRY_SANDBOX_SETTINGS` JSON (`{"resources": {...}}`, shared machinery with
   Daytona/TFY) and the Kubernetes-specific `KUBERNETES_SANDBOX_RESOURCES` env var, with the
   latter silently taking precedence when both are set. Not a bug, but a footgun — worth a
   comment or collapsing to one path.
4. ~~`provider.contract.test.ts` calls `pending(...)`, which is not a defined global in this
   repo's Jest setup~~ **Fixed in this review pass.** Confirmed by reproducing the identical bug
   in `LocalSandboxProvider`'s own contract-test fixture earlier this session; the catch block
   ran `pending(...)` (a `ReferenceError`, since Jasmine's `pending()` isn't a Jest global here)
   _before_ `throw error`, so any real failure — no cluster, bad kubeconfig, missing RBAC — would
   have surfaced as a confusing `ReferenceError: pending is not defined` instead of the actual
   cause. Replaced with `throw new Error(..., { cause: error })`: this suite is opt-in/manual (no
   CI job references it, matching Local's own suite), so failing loudly is the honest behavior.
   `prettier`/`tsc` (`tests/unit/tsconfig.json`) clean after the fix; not covered by `eslint`
   (see note below) or by any `tsc` pass specifically scoped to `*.contract.test.ts` files (see
   Remaining work) since none exists for either provider's contract test.

None of these block correctness of the core contract; the rest are reasonable to fix in a
follow-up or before merge, at the user's discretion.

**Correction to earlier "eslint clean" claims in this session:** `eslint.config.mjs` globally
ignores `**/*.test.ts` (comment: "Excluded from package tsconfigs; run via tsx/jest, not the
type-aware ESLint project") — repo-wide policy, not specific to this feature. Every
`eslint packages/trueforge/tests ...` run in this session that reported "clean" was, for test
files, trivially clean because nothing in that glob was actually linted. `prettier --check` did
still genuinely check test files (formatting is content-based, not project-based), and `tsc`
via `tests/unit/tsconfig.json` did too, **except** `*.contract.test.ts` files, which that
tsconfig explicitly excludes (see `tests/unit/tsconfig.json`'s `exclude`). So contract-test files
(both Local's and the new Kubernetes one) have never been type-checked by any `tsc` invocation in
this repo — only transpiled by swc at Jest runtime, which doesn't type-check. Not a defect this
session introduced; consistent pre-existing repo structure.

## Rulings on record (mine from earlier + implicit in the newer work)

1. **`PodBackend` mounts an `emptyDir` at the image `WORKDIR`, not a per-sandbox PVC.** Cost:
   sandbox files don't survive a pod _reschedule_ (they do survive a container restart).
2. **Sandbox id stays `<tenant>.<uuid>`**, pod name `sbx-<uuid>` — `/` and `.` are illegal in a
   Kubernetes resource name; keeps `validateSandboxOwnedByTenant` unchanged.
3. **`buildPodExecArgv` composes `cwd`/`env` into a shell script** — required by pods/exec's
   actual API shape (no such fields), not a judgment call.
4. **`uploadFile`/`downloadFile` skip TFY's base64 encoding**, going straight to `kubeExec`
   instead of through the shared string-typed `exec()`/`ExecResult` contract. Verified with a
   mutation test during the original implementation.
5. **Contract-suite generalization** (`sandboxProviderContractSuite.ts`) — brainstormed and
   user-approved as a bounded change before implementation.
6. _(New, implicit in the reviewed work, consistent with the above)_ **`AgentSandboxBackend`
   reuses `PodBackend`'s exact pod-spec shape** (working dir, container name, restart policy)
   inside the CR's `podTemplate`, so both backends produce behaviorally identical containers —
   the only difference is who owns pod lifecycle (the CR controller vs. `PodBackend` itself).
7. **User decision, explicit:** asked whether to cut `AgentSandboxBackend` (the CR path) and/or
   out-of-cluster port-forward support from Code Mode to shrink this PR, given CONTRIBUTING.md's
   "keep PRs focused and reasonably small" and its current size (38 files / ~3700 insertions).
   User chose to keep both. Consequence acted on: since out-of-cluster support stays, its
   resource-leak gap (Finding 1, original numbering) got fixed properly rather than documented
   as a known limitation — see the memoization fix above.

## Process note

`KubernetesSandboxProvider.ts` was originally written before its test file (~300 lines, ported
from `TFYSandboxProvider` under time/size pressure) — a deviation from strict TDD. Compensated
at the time with a full 19-test suite; 2 real failures surfaced and were fixed on their merits.
That file has since been edited further (reaper wiring, the `parseStatResult` fix, comment-style
fixes) without a corresponding new test for the reaper call inside `createSandbox` itself — the
reaper's own logic is well-tested in isolation (`reaper.test.ts`), but nothing currently asserts
`createSandbox()` actually invokes it. Minor test-coverage gap, not a correctness concern given
the code is trivially one `await this.reaper.reap()...` line.

## Environment gaps hit in this dev sandbox (not code defects)

- `pnpm` itself can't run inside the Claude Code bash sandbox (`unable to open database file` —
  its store lives outside the writable allowlist). Every `pnpm`/`jest`/`tsc`/`eslint` command in
  this session ran with `dangerouslyDisableSandbox: true`, or by invoking
  `node_modules/.bin/<tool>` directly.
- The real Local sandbox contract suite (`pnpm test:local-sandbox:contract`) cannot produce a
  pass here: `LocalSandboxProvider.isSupported()` reports false because this NixOS sandbox's
  plain `/bin/sh` can't resolve `bwrap` on `PATH`.
- **Correction: `kind`, `kubectl`, and `docker` (client) ARE installed in this environment**
  (`kind v0.32.0`, `kubectl v1.36.3`, `docker 29.7.2` client) — plan.md's "Environment gaps"
  section, written before any code existed, was wrong about this, or the environment changed
  since. **The actual gap is that the Docker daemon refuses this Unix user**:
  `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`,
  reproduced identically with the Bash sandbox disabled (`dangerouslyDisableSandbox: true`), so
  it's a host-level permission gap (this user isn't in the `docker` group / lacks socket access),
  not anything the Claude Code sandbox is adding on top. Not something to work around by
  escalating privileges — needs the user to fix on their end (`sudo usermod -aG docker $USER`
  and a new login session, or equivalent for this host's setup), or to run the kind-cluster steps
  from a shell that already has docker access.
- **The pinned sandbox image is private.** `curl -sI
https://tfy.jfrog.io/v2/tfy-images/trueforge-sandbox/manifests/0dab475d3d20a8333cff41f25f88e7134c424cf9`
  returns `401 Unauthorized`. `createKubernetesSandboxProvider.ts` hardcodes
  `SANDBOX_IMAGE_URI` with no override, so a `kind` cluster without registry credentials for
  `tfy.jfrog.io` will hit `ImagePullBackOff` on every sandbox creation (which `PodBackend`
  correctly surfaces as a loud, immediate failure — not a hang — but still blocks any live E2E
  run). Workaround for local testing: build the image locally and load it into the kind cluster
  under the **exact** pinned tag (the pod spec sets no `imagePullPolicy`, so a non-`latest` tag
  defaults to `IfNotPresent` and a locally-loaded image satisfies it without ever hitting the
  registry):
  ```bash
  TAG=$(node -p "require('./packages/trueforge-core/src/core/sandbox/sandboxImage.json').uri")
  docker build -t "$TAG" -f packages/trueforge-core/scripts/sandbox/sandbox.Dockerfile \
    packages/trueforge-core/scripts/sandbox/
  kind load docker-image "$TAG" --name trueforge-sandbox
  ```
- The new `test:kubernetes-sandbox:contract` needs a real cluster (`kind`/`kubectl`, present
  here) _and_ working docker access (absent here) _and_ either registry credentials or the
  locally-built-and-loaded image above. Not run in this environment for that reason — not for
  missing `kind`/`kubectl` as previously stated.

## Remaining work

- ~~Dedicated unit tests for `AgentSandboxBackend`~~ **Done** — 13 tests added
  (`AgentSandboxBackend.test.ts`), mirroring `PodBackend.test.ts`'s structure. Uncovered a real
  gap while writing them: see "Fixed: AgentSandboxBackend had no storage configuration" below.
- Dedicated unit tests for `createKubernetesSandboxProvider`'s CRD auto-detection branch (mocked
  `ApiextensionsV1Api`) — still not done.
- **Fix or accept Findings 1–3** (the NATS port-forward leak, reaper/create latency coupling, and
  the dual resource-config path). Finding 4 (`pending()`) was fixed earlier.
- **Catalog preset** — intentionally still not done; only applies if/when the env-synthesized
  scoping is revisited (the shipped catalog backs `CatalogSandboxProviderSchema`, which stays
  Daytona-only per the PR 1 descope).
- **Preempt the six #467 Bugbot findings** (plan.md's explicit merge-bar list): dead/evicted pod
  → `SandboxNotAvailableError` (done, both backends); `SANDBOX_IMAGE_URI` usage (done, via
  `createKubernetesSandboxProvider.ts`); loud `mkdir` failure checks (N/A — no FS-jail mkdir step
  in this design); restart-resumable ready/pull state (done implicitly — both backends always
  read live cluster state, no cached status); finding #6 (genericity) is PR 1, descoped.
- **Verification section of plan.md** (kind cluster, six acceptance criteria through the chat
  UI) — not attempted. `kind`/`kubectl`/`docker` (client) are installed in this environment, but
  the docker daemon denies this user and the pinned sandbox image is private — see "Environment
  gaps" above.
- ~~Final pass: run the exact 5 CI commands at the root~~ **Done**, twice (once mid-session, once
  after the fixes in the next section) — both times all five passed cleanly.

## Fixed: `AgentSandboxBackend` had no storage configuration

Found while writing its test suite (the item above). Its pod template had **zero** volume
configuration — no `emptyDir`, nothing — while `docs/sandbox.mdx` only called out a storage
caveat for the Pod fallback, implying (by omission) that the CR-backed path was better. It
wasn't: with no explicit mount, the CR path's container filesystem had no more durability
guarantee than any unmounted container layer — arguably _worse_ than `PodBackend`'s explicit
`emptyDir`, which at least survives a container restart. This also duplicated
`SANDBOX_WORKING_DIR` as a bare `'/home/trueforge'` string literal instead of importing the
existing constant.

**Fix:** exported `WORKSPACE_VOLUME_NAME` from `PodBackend.ts` (matching the existing precedent
of `SANDBOX_CONTAINER_NAME` already being shared that way), and `AgentSandboxBackend.body()` now
mounts the same `emptyDir` over `SANDBOX_WORKING_DIR` that `PodBackend` does — both backends now
have the identical, honestly-described durability characteristic (survives a container restart,
not a pod reschedule). `docs/sandbox.mdx`'s storage paragraph corrected to say so plainly instead
of implying an asymmetry that didn't exist in the code.

TDD: wrote the test first (`mounts writable storage over the image working directory, same as
PodBackend`), watched it fail (`expect(received).toBeDefined() — Received: undefined`), then
implemented. Full `AgentSandboxBackend.test.ts` — 13 tests, all passing, no `as`/`any` (an early
draft used `as Record<string, any>` to navigate the untyped CR body; replaced with runtime-guard
helpers mirroring the `isRecord()` pattern `AgentSandboxBackend.ts` itself already uses, per
AGENTS.md's "no assertion escapes" rule).

## Two other fixes from this pass

- **`README.md`** said sandbox support was "(Daytona today; more providers planned)" — stale
  since this PR ships Kubernetes too. Updated to "(Daytona via Settings, Kubernetes via env
  config for self-hosted deployments; more providers planned)". (`docs/roadmap.mdx` also has a
  stale "Local sandbox execution" roadmap bullet — that's pre-existing docs debt unrelated to
  this PR, since `LocalSandboxProvider` already shipped on `main` back in #306; left untouched to
  avoid scope creep on an already-oversized PR.)
- **Unrelated drive-by fix, `packages/trueforge-ui/src/atoms/primitives/DropdownMenu.tsx`** — 2
  pre-existing `react-hooks/exhaustive-deps` warnings were real, not false positives: `setOpen` is
  a `useCallback` with deps `[controlledOpen, onOpenChange]` (not React's always-stable
  `useState` setter), so omitting it from the outside-click and keyboard-nav effects' dependency
  arrays meant a controlled `DropdownMenu` with a changing `onOpenChange` prop could call a stale
  closure. Fixed by including `setOpen` in both dependency arrays, as the lint rule itself
  suggested. Verified: `trueforge-ui`'s full suite (199 files / 1516 tests, including a dedicated
  `DropdownMenu.test.tsx`) still passes. This touches a published package
  (`@truefoundry/trueforge-ui`), so it has its own changeset
  (`.changeset/plain-dryers-relax.md`, patch) separate from the Kubernetes one — genuinely
  unrelated to this PR's feature, worth considering as a separate commit/PR rather than folding
  into the Kubernetes squash, at the user's discretion.

## Conventions confirmed followed

No `as T` / non-null `!` / `as never` (confirmed clean via `eslint` + a manual read of every new
file — the one violation found, `KubernetesSandboxProvider.ts`'s `JSON.parse(...) as StatResult`,
has since been fixed); every catch-and-rethrow across `PodBackend.ts`/`AgentSandboxBackend.ts`
sets `{ cause }`; `SandboxBackend`/`PodApi`/`AgentSandboxApi`/`PodExecClient` are plain TS ports,
correctly not schemas (internal runtime contracts, not wire/DB shapes); `KubernetesSandboxProviderSchema`
correctly stays out of the OpenAPI union; env reads all go through `config.ts` (including the
in-cluster auto-detection); static `import`/`import type` only; tests live under
`tests/unit/sandbox/kubernetes/**` mirroring `src/sandbox/kubernetes/**`; options objects used
throughout; `.changeset` added and correctly scoped to the two published packages that actually
changed.

## CONTRIBUTING.md compliance audit (run in full, this session)

Fetched the live upstream copy (`raw.githubusercontent.com/truefoundry/trueforge/main/CONTRIBUTING.md`)
and confirmed it's byte-identical to the local copy — no drift to account for.

**Verified compliant:**

- **The literal 5 CI commands, run at the root, for real** (previously only run scoped
  per-package with various flags): `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint:ci`,
  `pnpm format:check` — **all exit 0**. `lint:ci` surfaces only 2 pre-existing warnings in an
  untouched file (`trueforge-ui/src/atoms/primitives/DropdownMenu.tsx`), no errors.
- No generated output touched: `git diff main --stat` against `packages/trueforge-sdk`,
  `python/trueforge_sdk`, `.github/fern/openapi/openapi.json`, `docs/openapi.json`,
  `packages/trueforge/catalog/` is empty.
- Coding-conventions bullets re-audited across the **whole** diff (not just this session's own
  pieces): no `as T` casts, no non-null `!`, no `require(`, no raw `process.env` outside
  `config.ts`, in `packages/trueforge/src` + `packages/trueforge-core/src`. Every
  catch-and-rethrow in the new backend files sets `{ cause }`; the handful of `throw new Error()`
  calls without one are fresh validation errors with no caught exception in scope (verified by
  reading each site), not swallowed causes.
- All new/changed test files live under `tests/` mirroring `src/` — none inline (`git diff main
--name-only -- '*.test.ts' | grep '/src/'` is empty).
- Docker is not required for the standard build/test/lint/typecheck path — only for the
  _optional_ `pnpm test:kubernetes-sandbox:contract` (kind cluster), matching how
  `test:local-sandbox:contract` is already opt-in/no-CI.
- `test:kubernetes-sandbox:contract` was added through `package.json` scripts (root + package),
  not documented as an ad hoc command.

**Not satisfied — known, not hidden:**

- **"Please only submit pull requests for an issue when you have received approval from a
  maintainer."** #817 has no maintainer approval and carries `needs-maintainer-attention`.
  Already an accepted risk per `plan.md`'s own decision ("proceed and submit anyway"), restated
  here because this audit is the place that should say it plainly rather than let it hide.
- **"Keep PRs focused and reasonably small."** This is not small — 36 files, ~3600 insertions,
  a full new provider plus a cross-cutting config-gating fix. A tradeoff already made in favor of
  landing a working end-to-end feature rather than a chain of dependent micro-PRs (which would
  only multiply review burden given the point above).
