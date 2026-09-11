# @truefoundry/trueforge-core

## 0.2.0-rc.4

### Patch Changes

- ba79ce5: Add TFY sandbox agent instructions to discover the working directory via `pwd` before writing files.

## 0.2.0-rc.3

### Patch Changes

- db37b6e: Sandbox skills: unify git and registry mounts onto `.tfy-desired-skills.json` (SkillMounter + skill_downloader), and always attach a mounter so existing skills are cleaned up.
- 762ecc0: TrueFoundry skills catalog: proxy GET /skills and /skills/versions from ServiceFoundry; settings skill writes return 424. SkillManifest is a type-discriminated oneOf of GitSkill | TrueFoundryRegistrySkill (`type: truefoundry`; name is FQN, display_name is short). AvailableSkill exposes optional metadata (display_name, repository_name, version). AgentSpec skill refs allow opaque FQN names, optional preload (registry), and max 50. UI draft skill mounts map catalog `id` to AgentSpec `name`.
- fc38f74: AgentSpec skills: TrueFoundry save/turn resolve via SFY; standalone git validate/resolve on the skill store.
- 4111287: Add POST `/api/internal/list-permissions` via `Authorizer.getPermissions` (owner grants for schedules/sessions; agents include `USE`, with TrueFoundry agents mapped from SFY `USE_AGENT`/`MANAGE_AGENT`/`DELETE_AGENT`).
- a36ffaf: Namespace all Redis keys and pub/sub channels under `tfg:` so TrueForge can share a Redis instance without colliding with other apps.
- 44f9cbe: TrueFoundry mode: env-backed Daytona | truefoundry sandbox via TRUEFOUNDRY_SANDBOX_* (static SETTINGS JSON). Settings OpenAPI stays Daytona-only (`SandboxProviderManifest`); truefoundry is store-internal (`StoredSandboxProviderManifest`).
- afe816e: Default `cache_control` to `{ type: 'ephemeral' }` for `truefoundry` provider model calls (overridable via request body).
- a5f220f: Dedupe LLM resolve within a turn so parent and sub-agents sharing a model name call deps.llm once.

## 0.2.0-rc.2

### Patch Changes

- a000b47: List sessions accepts `metadata[key]=value` query params (OpenAPI deepObject) for exact metadata containment filtering. Bare JSON-string `metadata` query params are rejected. Metadata keys are limited to 32 characters and cannot include `[]` or whitespace so they do not collide with the bracket query form.
- 0ec8dc6: Omit session `total_cost_in_usd` when cost is unavailable (instead of defaulting to 0), matching turn metrics.
- 11865b4: Add optional session `source`. Persist as nullable JSONB with a list filter index; expose on session responses and list via `source_type` / `source_id`. Schedule dispatch sets source on create; public create/update do not accept it.
- 5d72138: Keep `npx @truefoundry/trueforge` working on native Windows: import Kysely migrations with `pathToFileURL`, and keep sandbox guest paths POSIX. Source development stays Unix/WSL; CI also runs unit and SQLite store tests on Windows.

## 0.2.0-rc.1

### Minor Changes

- a70543b: Agent access is decided only by the `Authorizer`: standalone/OIDC lets everyone list and use agents and restricts update/delete to the creator; TrueFoundry uses external permissions api.

  You can read a session, turn, events, metrics, schedule, or its runs if you created it, or if you manage the named agent it is bound to. Creating still requires permission to use that agent. Only the creator can update, delete, or cancel a session, create a turn, or download sandbox files. Only the creator can update, delete, pause, resume, or run a schedule. An OIDC settings admin can no longer see other users' schedules.

- 9bfcdaa: Replace string creator fields (`created_by` / `triggered_by`) with a non-null `created_by_subject` JSON object on agent, session, schedule, and schedule_run. Ownership and list filters use `tenant_id` + `created_by_subject.subject_id`.
- 8f1a2dc: Add a TrueFoundry-managed model registry. When `TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` is set, models are listed from the TrueFoundry ServiceFoundry server and turns are routed through the tenant's default AI Gateway with the caller's token. Mutually exclusive with OIDC. Supports internal mutual TLS to the ServiceFoundry server via `TRUEFOUNDRY_MTLS_ENABLED`/`TRUEFOUNDRY_MTLS_CERTS_DIR`.

### Patch Changes

- d89b2ff: Persist zero-initialized metrics on agent sessions.
- 172bf14: Add caller-scoped session metrics meters, charts, and chart-data under `/internal/metrics` via a server-owned `ISessionMetricsStore`.
- d89b2ff: Fold session metrics totals on createTurn and terminal writes.
- c40129c: Cap Daytona status-refresh calls at 1 minute so a stalled provider cannot hang request handlers.
- 38ce068: Add tenant-unique optional session `external_id`, `Sessions.getOrCreateByExternalId`, and an idempotent `POST /internal/sessions/get-or-create-by-external-id` endpoint and SDK method.
- b654052: Add caller-owned session `metadata` (`Record<string, string>` with size limits) on create, update, and read. Persist as a new `session.metadata` jsonb column; leave session `custom` unchanged.

## 0.2.0-rc.0

### Minor Changes

- 0297727: Add context-management compaction triggers with model-aware defaults and migrate persisted legacy token thresholds.

### Patch Changes

- 940c4e5: Prefer MCP Python SDK 2.0 snake_case tool annotation fields, with camelCase fallback for older SDKs, without changing destructive-tool detection behavior.
- a655537: Update published dependency ranges (AI SDK, Hono, MCP SDK, Redis, assistant-ui, and related packages).

## 0.1.4

### Patch Changes

- 42eee39: Enable a standalone in-memory local sandbox fallback (no settings row), persist fancy `v1:type:raw` sandbox ids, drop tenant-prefix ownership checks, keep TFY sandbox writes cwd-relative (no `/opt` / `/usr/local`), let each sandbox provider own PATH (no hardcoded Daytona tail in Sandbox), and grant only the Code Mode socket parent in SRT (not host `/tmp`).
- d7a640f: Align OpenAPI type names across AgentSpec, settings, catalogs, and chat pickers: Catalog/Configured/Available resource views, AgentSpec nested Model/Skill/InitialUserMessage, Put*Request → Update*Request, MCP acronym casing, GetMeResponse, and explicit names for nested AgentSpec/capabilities schemas.
- 7ae5376: Update SANDBOX_IMAGE_URI to the image pushed by CI.
- 889caca: Persist `model.message` with omitted null content and deferred `call_tool` wrapper `tool_info`, matching the live stream.
- 2ca7fb2: Remove unused `config.sandbox.network_policy` (git auth inject) from the public AgentSpec.
- 43d780e: Load SANDBOX_IMAGE_URI from sandboxImage.json so CI can rewrite the pin.

## 0.1.4-rc.0

### Patch Changes

- 42eee39: Enable a standalone in-memory local sandbox fallback (no settings row), persist fancy `v1:type:raw` sandbox ids, drop tenant-prefix ownership checks, keep TFY sandbox writes cwd-relative (no `/opt` / `/usr/local`), let each sandbox provider own PATH (no hardcoded Daytona tail in Sandbox), and grant only the Code Mode socket parent in SRT (not host `/tmp`).
- d7a640f: Align OpenAPI type names across AgentSpec, settings, catalogs, and chat pickers: Catalog/Configured/Available resource views, AgentSpec nested Model/Skill/InitialUserMessage, Put*Request → Update*Request, MCP acronym casing, GetMeResponse, and explicit names for nested AgentSpec/capabilities schemas.
- 7ae5376: Update SANDBOX_IMAGE_URI to the image pushed by CI.
- 889caca: Persist `model.message` with omitted null content and deferred `call_tool` wrapper `tool_info`, matching the live stream.
- 2ca7fb2: Remove unused `config.sandbox.network_policy` (git auth inject) from the public AgentSpec.
- 43d780e: Load SANDBOX_IMAGE_URI from sandboxImage.json so CI can rewrite the pin.

## 0.1.3

### Patch Changes

- 08700d1: Pin `mcp==1.29.0` in the sandbox image so Code Mode can import `mcp.types`.
- c546350: Pass `tenantName` on `SandboxOptions` instead of injecting `TFY_TENANT_NAME` via exec env.

## 0.1.2

### Patch Changes

- 363a522: Wire shared sandbox Code Mode once in SessionHandle from main toolSets before building threads.
- 5b981ab: Cancel a session even when the owning executor is gone (restart) or Redis cannot confirm abort. Freeze the running turn in the store so a new turn can start. `freezeAndGetTurn` now takes the cancellation reason (barge-in stays `cancelled-for-next-turn`; explicit cancel stays `client-cancelled`). Redis timeout and transport failures still freeze, with a warning that the cancel is not clean.

## 0.1.1

### Patch Changes

- 69237db: Await Daytona snapshot registration on sandbox provider configure so auth failures return 422 instead of a false pending status, and keep GET status refreshes persisted.
- 7783fc0: Instruct ask_user_question to mark a first option as (Recommended) when context clearly favors one.

## 0.1.0

### Minor Changes

- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.

## 0.1.0-rc.0

### Minor Changes

- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.
