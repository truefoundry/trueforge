# Kubernetes Sandbox Provider for TrueForge (#817)

## Context

Issue #817 asks for Kubernetes as a sandbox provider so TrueForge can be fully self-hosted on a cluster.
Unassigned, no linked PR, no maintainer reply since Sep 18.

**Research findings that shape the approach:**

- **Implementation is not the bottleneck.** Four community sandbox-provider PRs sit unreviewed 4+ weeks:
  #393 (E2B), #448 (OpenSandbox), #467 (Docker), #557 (Modal).
- **`CONTRIBUTING.md` requires maintainer approval before any PR**, and states: _"we focus community
  contributions on issue reports, analysis, and feedback, over larger code changes."_ Their label table defines
  `needs-maintainer-attention` as _"needs discussion with maintainers before implementation can start"_ — and
  #817 carries that label. **Decision: proceed and submit anyway; accepted risk of closure on policy grounds.**
- **The repo asks for the genericity work in a comment.** `schemas/sandboxCatalog.ts`: _"Single variant today …
  Widen to a discriminated union when a second provider ships."_
- **The shared wall is the UI adapter.** `sandboxProviderCatalog.ts#toHarnessManifest` throws
  `Unsupported sandbox provider type` for non-Daytona; `resolveApiKey` assumes `manifest.auth.api_key`.
- **Cursor Bugbot is the effective reviewer.** #467 has zero human comments and six Bugbot findings.
- **`TFYSandboxProvider` is the template, not Daytona** — already K8s-shaped: HTTP exec, cluster-internal NATS
  WS URL, cwd-relative layout, static `ready` image (no build step).
- **PR #814 (open, core team) will change the factory signature** to pass full `SandboxInfo` instead of
  `sandbox_id`, and adds `/api/v1/sandbox-environments` (image, resources/GPU, lifecycle, networking).

## PR 1 — Multi-provider genericity

Smaller than first scoped: `schemas/sandboxProvider.ts` **already** defines
`StoredSandboxProviderManifestSchema = z.discriminatedUnion('type', [Daytona, TrueFoundry])`. The union pattern
exists at the store layer; only settings/OpenAPI and the UI adapter are Daytona-locked.

| File                                                                       | Change                                                                                                                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/trueforge/src/schemas/sandboxProvider.ts`                        | Add `KubernetesSandboxProviderSchema`; add it to the existing stored discriminated union                                                                                      |
| `packages/trueforge/src/schemas/sandboxCatalog.ts`                         | Widen `CatalogSandboxProviderSchema` to `z.discriminatedUnion('type', …)` — the change its own comment requests                                                               |
| `packages/trueforge-ui/src/plugins/.../catalogs/sandboxProviderCatalog.ts` | `toHarnessManifest` dispatches on `type` instead of throwing; `resolveApiKey` tolerates an absent `auth`; per-type config mapping replaces the inlined `DaytonaSandboxConfig` |
| `packages/trueforge-ui/test/plugins/.../sandboxProviderCatalog.test.ts`    | Non-Daytona type round-trip                                                                                                                                                   |

Forcing argument for the PR description: **Kubernetes has no API key** (kubeconfig / in-cluster ServiceAccount),
so `auth` must be optional. Reference the four blocked PRs.

## PR 2 — `KubernetesSandboxProvider`

Community providers live in `packages/trueforge`, not `trueforge-core` (core holds only first-party Daytona and
TFY). Follows `LocalSandboxProvider` and PR #467's Docker provider.

```
packages/trueforge/src/sandbox/kubernetes/
  provider/KubernetesSandboxProvider.ts   # implements SandboxProvider
  backend/SandboxBackend.ts               # internal iface: create / delete / ready / podRef
  backend/AgentSandboxBackend.ts          # kubernetes-sigs Sandbox CR (preferred)
  backend/PodBackend.ts                   # raw Pod + PVC fallback
  core/kubeExec.ts                        # pods/exec via @kubernetes/client-node
  core/reaper.ts                          # label-selector GC of orphaned sandboxes
```

**Backend selection.** Prefer `kubernetes-sigs/agent-sandbox` v1.0.2 (SIG Apps): stable identity, persistent
storage, lifecycle, and a stable per-sandbox hostname that makes NATS reachable without extra Services. Detect
the `sandbox.x-k8s.io` CRD once at construction via the discovery API, cache the result, else fall back to
`PodBackend`. Surface the choice in `SandboxBuild.metadata`.

**Method implementations** — read `TFYSandboxProvider.ts` (327 lines) first; most port near-verbatim:

- `buildImage` / `getImageBuildStatus` -> static `ready`. Kubernetes pulls from a registry; there is no build
  step. Add a `case 'kubernetes'` early return to `checkSnapshotStatus` in `providerUtils.ts`, mirroring the
  existing `truefoundry` branch.
- `createSandbox` -> create CR/Pod from `SANDBOX_IMAGE_URI` (`sandboxImage.json`), label tenant +
  `app=trueforge-sandbox`, wait Ready. `sandboxId` = `<namespace>/<name>`; keep `validateSandboxOwnedByTenant`.
- `exec` -> `pods/exec`. Reuse `absolutizeRelativeExecEnv`; copy TFY's `sandboxLayout()` pwd/`$PATH` discovery
  and `withMcpClientOnPath` rather than hardcoding a layout. Honour `timeoutSeconds`.
- `uploadFile` / `downloadFile` -> TFY's channel-agnostic pattern works unchanged: `stat -L --printf` for
  size/type, `base64 -w0` to download, enforce `fileMaxBytesForDownload`, raise the existing `SandboxErrors`.
- Layout getters -> cwd-relative as TFY (`skills`, `uploads`, `tool-results`, `.git-credentials`,
  `skill_downloader.py`, `mcp-client/mcp_client.py`). Satisfies the contract suite's escape assertions with no
  FS jail.
- `createCodeModeTransport` -> `CodeModeNatsTransport` with
  `sandboxClientNatsUrl: ws://localhost:${DEFAULT_SANDBOX_NATS_WS_PORT}`. The shipped image already runs NATS
  (`trueforge-core/scripts/sandbox/nats.conf`). `resolveHostUrl` returns the in-cluster hostname when running
  in-cluster; out-of-cluster it establishes a port-forward. **Only novel piece — build first, main risk.**

**Registration.** Add `case 'kubernetes':` to `toSandboxProviderFromRecord` (its comment, _"One switch on
`manifest.type`"_, marks the extension point). Add the preset to `packages/trueforge/catalog/sandbox-catalog.yaml`
— namespace, service account, resources, exec timeout, image pull secret; no API key.

**Preempt the six #467 Bugbot findings** (the de facto merge bar; state this in the PR description):
dead/evicted pod on exec -> `SandboxNotAvailableError`; TTL + label-selector reaping invoked server-side, not only
on `dispose`; use `SANDBOX_IMAGE_URI` so `python`/`pydantic`/`git` are present; check layout `mkdir` exit codes
and fail creation loudly; make ready/pull state restart-resumable by reading live cluster state; finding #6 is
handled by PR 1.

**Tests.** Wire `runSandboxProviderContractSuite` into
`packages/trueforge/tests/unit/sandbox/kubernetes/provider/provider.contract.test.ts`, mirroring the Local
provider's contract test. Mocked-client unit tests for backend detection, reaping, upload/download edges. Tests
live under a top-level `tests/` mirroring `src` (per AGENTS.md), never inline. Add a changeset — CI requires one.

## Verification

```bash
kind create cluster --name trueforge
kubectl apply --server-side -f https://github.com/kubernetes-sigs/agent-sandbox/releases/download/v1.0.2/manifests.yaml
kubectl wait --for=condition=Available deploy -n agent-sandbox-system --all --timeout=180s

pnpm --filter @truefoundry/trueforge test -- kubernetes/provider/provider.contract
TRUEFORGE_K8S_FORCE_POD_BACKEND=1 pnpm --filter @truefoundry/trueforge test -- kubernetes/provider/provider.contract

# CI runs exactly these five:
pnpm build && pnpm test && pnpm typecheck && pnpm lint:ci && pnpm format:check
```

Then the six acceptance criteria the maintainers wrote on #370/#387, manually through the chat UI against kind:
`echo 1`; write a file in turn 1 and `cat` it in turn 2; Code Mode via the MCP client; upload a CSV and analyse
it; agent writes a file and you download it; image sync status (static `ready`). Run once with the agent-sandbox
operator installed and once with the CRD absent, to exercise `PodBackend`.

## Conventions to honour (AGENTS.md)

No `as T` / non-null `!` escapes; wrap-and-rethrow preserves `{ cause }`; types via `z.infer`, not duplicated
interfaces; static `import` only; wire shapes and DB identifiers in `snake_case`; env reads go through
`packages/trueforge/src/config.ts`, never `process.env`. Do not commit generated OpenAPI/SDK output — forks are
source-only.

## Risks

- **PR #814 lands first** and changes the factory signature (`SandboxInfo` vs `sandbox_id`). Rebasing is cheap if
  backend config already lives in a manifest.
- **Policy risk (accepted).** CONTRIBUTING.md requires prior approval and #817 is `needs-maintainer-attention`;
  the PR may be closed unreviewed regardless of quality.
- **Overlap with TrueFoundry's commercial hosted sandbox.** `TFYSandboxProvider` is their own K8s-backed
  offering, which plausibly explains the #817 silence. Frame this as self-host-only, BYO cluster.
- **rahulduvedi offered a kind-tested implementation on Sep 22** but opened no PR. Credit them on the thread when
  opening ours to avoid a duplicate-work collision.

## Environment gaps

`kind` and `kubectl` are not installed locally (node 24.19.0, pnpm 11.22.0, docker 29.7.2 are present). The
extracted source is a tarball with no git remotes — a fork and clone are needed before branching.
