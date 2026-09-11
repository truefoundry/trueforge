# @truefoundry/trueforge

## 0.2.0-rc.6

### Minor Changes

- 0453157: Use ServiceFoundry dual vend-token response: authenticate as the agent for registry lookups, and as the user (with agent in `act`) for MCP authorize/auth status, gateway model api_key, and MCP invoke.

### Patch Changes

- 8c31eae: Persist top-level agent description and sync it to ServiceFoundry on create/update.
- 4e3b5be: Forward session, turn, and agent context as `x-tfy-metadata` on TrueFoundry-mode model and MCP gateway calls.
- 9501536: Make MCPServerManifest a type-discriminated oneOf of RemoteMCPServerManifest and TrueFoundryMCPServerManifest.
- dc2151f: Paginate `GET /api/v1/agents` with `limit` / `page_token` and a `pagination` envelope; optional `agent_name` filters by case-insensitive substring. Agents library uses rows-per-page and prev/next against the token-paginated API. Schedule create and the schedules listing agent filter use a searchable agent combobox backed by the same filtered list API.
- Updated dependencies [648273b]
- Updated dependencies [9501536]
- Updated dependencies [dc2151f]
- Updated dependencies [ba79ce5]
  - @truefoundry/trueforge-sdk@0.2.0-rc.5
  - @truefoundry/trueforge-core@0.2.0-rc.4

## 0.2.0-rc.5

### Patch Changes

- 502699b: Include `token: "USER_API_KEY"` in TypeScript agent code snippets when OIDC or TrueFoundry auth is enabled.
- 4e72afc: Announce boot loading with a light-themed orb for contrast outside ThemeProvider.
- 4e72afc: Use an animated thinking orb for application boot and server initialization.

## 0.2.0-rc.4

### Minor Changes

- 4b120b8: Schedule runs now execute through one internal API call authenticated with `TRUEFORGE_API_KEY`. The server loads the saved run, schedule, and agent, then uses one agent-scoped token for turn resources in TrueFoundry mode.

### Patch Changes

- 629b6e9: Show Created by (avatar + name) on Agents and Schedules tables when creator info is present.
- Updated dependencies [648273b]
  - @truefoundry/trueforge-sdk@0.2.0-rc.4

## 0.2.0-rc.3

### Minor Changes

- 74eae6c: Remove pagination from list MCP servers across the API, SDK, and UI; return and search the complete configured MCP catalog client-side.

### Patch Changes

- db37b6e: Sandbox skills: unify git and registry mounts onto `.tfy-desired-skills.json` (SkillMounter + skill_downloader), and always attach a mounter so existing skills are cleaned up.
- 762ecc0: TrueFoundry skills catalog: proxy GET /skills and /skills/versions from ServiceFoundry; settings skill writes return 424. SkillManifest is a type-discriminated oneOf of GitSkill | TrueFoundryRegistrySkill (`type: truefoundry`; name is FQN, display_name is short). AvailableSkill exposes optional metadata (display_name, repository_name, version). AgentSpec skill refs allow opaque FQN names, optional preload (registry), and max 50. UI draft skill mounts map catalog `id` to AgentSpec `name`.
- fc38f74: AgentSpec skills: TrueFoundry save/turn resolve via SFY; standalone git validate/resolve on the skill store.
- f2ca338: Show a spinner on the app boot screens instead of "Loading application…" text.
- 4c522e2: Bump `@truefoundry/assistant-ui-runtime` to `0.1.30`.
- 4c522e2: Bump `@truefoundry/assistant-ui-runtime` to `0.1.31`.
- b32d2be: Filter chat history to sessions created by the current user, and bump `@truefoundry/assistant-ui-runtime` to `0.1.34`.
- a9430bd: Accept optional `base_url` on agent code-snippets (FE public host); fall back to request origin + `PUBLIC_BASE_URL` path.
- 349e420: Add internal POST /api/internal/import/agents and POST /sessions (snapshot) plus GET /checkpoint?tenant_id= for SF→TrueForge backfill. Import requires the service API key. Named session import links a local agent when present (or SF agent_id / dummy). Drafts use agent_spec; when SF also sends name/id those go in metadata. Checkpoint is per-tenant min created_at of imported sessions.
- 4111287: Add POST `/api/internal/list-permissions` via `Authorizer.getPermissions` (owner grants for schedules/sessions; agents include `USE`, with TrueFoundry agents mapped from SFY `USE_AGENT`/`MANAGE_AGENT`/`DELETE_AGENT`).
- 4e7b67a: Check live per-user MCP authentication before loading tools in the agent builder.
- 2b6c566: Paginate `GET /api/v1/schedules/{schedule_id}/runs` with `limit` / `page_token` and a `pagination` envelope.
- a1af95d: Add public GET /api/v1/mcp-servers/{name} returning the chat projection with live per-user auth_status.
- a36ffaf: Namespace all Redis keys and pub/sub channels under `tfg:` so TrueForge can share a Redis instance without colliding with other apps.
- 555bef0: Allow sandbox artifact downloads to use paths relative to the sandbox working directory.
- e307f15: Derive the UI public prefix from the pathname of `PUBLIC_BASE_URL` at process start so one published frontend can run behind any path-stripping proxy.
- bb8d3d3: Persist optional `reason` on schedule runs when hand-off fails. Exposed on ScheduleRun responses as nullable string.
- 46fadce: Point-lookup ServiceFoundry model integrations by provider account and model name, and fetch the full catalog in one unpaginated request.
- b601db8: Simplify agent Use In Code snippets to create/stream/print/map/merge events.
- 5b33ab6: TrueFoundry skills: use caller JWT for catalog/validate; never agent vend tokens.
- 5e68fa4: TrueFoundry-mode `/api/v1/auth/login` redirects to `PUBLIC_BASE_URL` origin + caller `return_to` (platform `/signin/external?redirectPath=…`).
- 1c16780: TrueFoundry MCP: live SFY auth status on single-server GET and mid-turn authorize gating for every auth mode.
- 44f9cbe: TrueFoundry mode: env-backed Daytona | truefoundry sandbox via TRUEFOUNDRY_SANDBOX_* (static SETTINGS JSON). Settings OpenAPI stays Daytona-only (`SandboxProviderManifest`); truefoundry is store-internal (`StoredSandboxProviderManifest`).
- Updated dependencies [db37b6e]
- Updated dependencies [762ecc0]
- Updated dependencies [648273b]
- Updated dependencies [fc38f74]
- Updated dependencies [648273b]
- Updated dependencies [648273b]
- Updated dependencies [4111287]
- Updated dependencies [74eae6c]
- Updated dependencies [a36ffaf]
- Updated dependencies [44f9cbe]
- Updated dependencies [afe816e]
- Updated dependencies [a5f220f]
  - @truefoundry/trueforge-core@0.2.0-rc.3
  - @truefoundry/trueforge-sdk@0.2.0-rc.3

## 0.2.0-rc.2

### Patch Changes

- a000b47: List sessions accepts `metadata[key]=value` query params (OpenAPI deepObject) for exact metadata containment filtering. Bare JSON-string `metadata` query params are rejected. Metadata keys are limited to 32 characters and cannot include `[]` or whitespace so they do not collide with the bracket query form.
- 0ec8dc6: Omit session `total_cost_in_usd` when cost is unavailable (instead of defaulting to 0), matching turn metrics.
- 461166e: Use agent name for ServiceFoundry remote agent description so save succeeds when instructions are empty.
- 11865b4: Add optional session `source`. Persist as nullable JSONB with a list filter index; expose on session responses and list via `source_type` / `source_id`. Schedule dispatch sets source on create; public create/update do not accept it.
- 3c1d544: Fetch MCP servers and gateway installations in parallel.
- ac091cc: TrueFoundry mode: shared Daytona sandbox via TRUEFOUNDRY_SANDBOX_* env and settings-server snapshot (lru-cache TTL).
- 5d72138: Keep `npx @truefoundry/trueforge` working on native Windows: import Kysely migrations with `pathToFileURL`, and keep sandbox guest paths POSIX. Source development stays Unix/WSL; CI also runs unit and SQLite store tests on Windows.
- Updated dependencies [a000b47]
- Updated dependencies [0ec8dc6]
- Updated dependencies [11865b4]
- Updated dependencies [5d72138]
  - @truefoundry/trueforge-core@0.2.0-rc.2
  - @truefoundry/trueforge-sdk@0.1.4-rc.2

## 0.2.0-rc.1

### Minor Changes

- 8491843: Add a slot-driven agent Metrics tab with aggregate cards, time-range filtering, and Harness-backed line charts.
- a70543b: Agent access is decided only by the `Authorizer`: standalone/OIDC lets everyone list and use agents and restricts update/delete to the creator; TrueFoundry uses external permissions api.

  You can read a session, turn, events, metrics, schedule, or its runs if you created it, or if you manage the named agent it is bound to. Creating still requires permission to use that agent. Only the creator can update, delete, or cancel a session, create a turn, or download sandbox files. Only the creator can update, delete, pause, resume, or run a schedule. An OIDC settings admin can no longer see other users' schedules.

- 49164e7: Add optional mutual TLS for the HTTPS listener and schedule controller→server hop via `TRUEFORGE_MTLS_ENABLED` / `TRUEFORGE_MTLS_CERTS_DIR`. Off by default; independent of ServiceFoundry `TRUEFOUNDRY_MTLS_*`.
- 9bfcdaa: Replace string creator fields (`created_by` / `triggered_by`) with a non-null `created_by_subject` JSON object on agent, session, schedule, and schedule_run. Ownership and list filters use `tenant_id` + `created_by_subject.subject_id`.
- a3a1395: Adds first-class cron schedules for existing agents: persist them, manage them via /api/v1/schedules, validate cron policy at write time, and advance due runs through a single-dispatcher claim path.
- 4b1aa55: Enforce external agent authorization on agent list, get, snippets, update, delete, and referenced-agent use.
- ef316d2: Add optional `OIDC_ALLOWED_EMAILS` allowlist (exact addresses and `*` globs) so OIDC logins can be limited to approved emails or domains.
- 2025cef: Store Postgres app tables and Kysely migration bookkeeping in a dedicated `trueforge` schema, with an automatic one-time move from `public` so existing installs keep their data and migration history.
- 8f1a2dc: Add a TrueFoundry-managed model registry. When `TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` is set, models are listed from the TrueFoundry ServiceFoundry server and turns are routed through the tenant's default AI Gateway with the caller's token. Mutually exclusive with OIDC. Supports internal mutual TLS to the ServiceFoundry server via `TRUEFOUNDRY_MTLS_ENABLED`/`TRUEFOUNDRY_MTLS_CERTS_DIR`.
- 4137af1: Unify request-scoped RequestContext across standalone, OIDC, and TrueFoundry auth. `/auth/me` returns `{ data: { type, tenant_id, subject, roles } }` (`type` is `oidc-connected` | `default`; OpenAPI/SDK regen deferred to CI).

### Patch Changes

- d89b2ff: Persist zero-initialized metrics on agent sessions.
- 172bf14: Add caller-scoped session metrics meters, charts, and chart-data under `/internal/metrics` via a server-owned `ISessionMetricsStore`.
- d89b2ff: Fold session metrics totals on createTurn and terminal writes.
- af40621: Add persisted `agent.metadata` on Postgres and SQLite; store `updateAgent` can patch manifest and/or metadata.
- 1c67237: Add agent `external_id` (`string | null` on create) with a tenant-scoped partial unique index (Postgres and SQLite).
- 38abb11: Sync ServiceFoundry remote agents on create/update/delete and store the remote id in `external_id`. Filter `listAgents` by `external_ids`. Keep general ServiceFoundry HTTP at 10s and agent CRUD calls at 3s.
- 49360bc: Drop unused `agent.metadata`; remote identity is stored in `external_id`.
- 38abb11: Reject reserved agent names `tfg` and `trueforge` in create requests.
- 7968f59: Use injected `db` for TrueFoundryAgentStore advisory-lock transactions.
- a60f4c2: Add GET /api/v1/agents/{agent_id}/code-snippets with TypeScript TrueForge SDK stream and non-stream samples.
- 55cc5e7: Add a dedicated controller entry point (`dist/controller-main.js`) that runs the periodic control loops (schedule dispatch) as a single-replica process for distributed mode (`STANDALONE=false`). It targets the server API via the new `SERVER_URL` env (default `http://localhost:$PORT`). Standalone mode keeps running the controller inside the server process.
- 2dcb3a0: Add `created_by_me` to list sessions and list schedules so callers can restrict results to resources they created (excluding managed-agent visibility).
- 58940a7: Report a Daytona key that cannot register snapshots as missing key permissions (403) instead of an invalid API key (422), and name the grants to add in the Daytona dashboard.
- c40129c: Cap Daytona status-refresh calls at 1 minute so a stalled provider cannot hang request handlers.
- 9f3b4cd: Make optional `VITE_BASE_PATH` apply to both the UI public path and API/auth URLs (defaults to `/`).
- 80d5bee: Move `resolveInvokeHeaders` onto `IMcpServerWithAuthStore` (not `IMcpServerStore`) so DB backends stay CRUD-only and turn/MCP invoke paths take the request-scoped with-auth store for configured headers and TrueFoundry gateway Bearer.
- 541d65d: Split MCP server persistence (`IMcpServerStore`) from Connect UX auth (`IMcpServerWithAuthStore` / `McpServerWithAuthStore`) so DB backends stay CRUD + OAuth client columns while authorize/status/revoke compose in via a token store.
- c65b813: Apply `POSTGRES_SSL_MODE` as `sslmode` on the Postgres connection URL.
- f4fb4bd: Accept `DATABASE_URL` for hosted mode so managed Postgres (e.g. Railway) can be wired without discrete `POSTGRES_*` vars.
- a37cdea: Add NOT NULL `agent_id` on `schedule` (backfilled from `agent`), FK to `agent(id)` ON DELETE CASCADE (replacing the `(tenant_id, agent_name)` FK), and `(tenant_id, agent_id)` index for per-agent listing.
- 3bc2ed8: List schedules is token-paginated (`limit` / `page_token`) and filters by comma-separated `agent_names`.
- feb94aa: Add GET /api/v1/schedules/{schedule_id}/runs to list a schedule's runs (newest `scheduled_for` first), with the same creator-or-admin access as other schedule routes.
- 8e64757: Add POST /api/v1/schedules/runs to trigger an immediate schedule run
- 4ced8ef: Dispatch schedule runs through the session/turn API: get-or-create a session keyed by run id, then create a turn only when that session has none.
- 38ce068: Add tenant-unique optional session `external_id`, `Sessions.getOrCreateByExternalId`, and an idempotent `POST /internal/sessions/get-or-create-by-external-id` endpoint and SDK method.
- b654052: Add caller-owned session `metadata` (`Record<string, string>` with size limits) on create, update, and read. Persist as a new `session.metadata` jsonb column; leave session `custom` unchanged.
- 4c1260e: Wire TrueFoundry MCP authorize, status, and delete through ServiceFoundry; stub list auth_status; gate oauth2 invoke mid-turn with authRequired; paginate MCP server lists. UI treats SFY consent `code`/`error` on the FE landing like local DCR success/failure.
- 32bf7d6: TrueFoundry MCP invoke headers are owned by the MCP store (`resolveInvokeHeaders`), so gateway Bearer comes from the request-scoped store rather than being threaded through turn/tools APIs.
- 185dc04: Per-MCP-server request headers via `x-tfg-mcp-headers`, merged into the invoke headers for the named server. Lets a caller that authenticates as one identity give each MCP server the identity it should actually see.
- f175245: Add TrueFoundry-managed MCP list/get (SFY registry, gateway proxy URL, create/update 424).
- Updated dependencies [648273b]
- Updated dependencies [d89b2ff]
- Updated dependencies [648273b]
- Updated dependencies [172bf14]
- Updated dependencies [d89b2ff]
- Updated dependencies [a70543b]
- Updated dependencies [2dcb3a0]
- Updated dependencies [9bfcdaa]
- Updated dependencies [c40129c]
- Updated dependencies [52987a7]
- Updated dependencies [38ce068]
- Updated dependencies [b654052]
- Updated dependencies [4c1260e]
- Updated dependencies [8f1a2dc]
- Updated dependencies [f175245]
  - @truefoundry/trueforge-sdk@0.1.4-rc.1
  - @truefoundry/trueforge-core@0.2.0-rc.1

## 0.2.0-rc.0

### Minor Changes

- 0297727: Add context-management compaction triggers with model-aware defaults and migrate persisted legacy token thresholds.

### Patch Changes

- 3539da2: Add `brand.mode` (`icon-title` | `icon-only` | `logo`) so hosts pick chrome look first; `name` always labels the mark, and `resolveBrandChrome` maps mode to layout chrome.
- 940c4e5: Prefer MCP Python SDK 2.0 snake_case tool annotation fields, with camelCase fallback for older SDKs, without changing destructive-tool detection behavior.
- a655537: Update published dependency ranges (AI SDK, Hono, MCP SDK, Redis, assistant-ui, and related packages).
- 5ccac3d: Update /healthz to return JSON status and package version
- fba6129: Require Node.js 22.14+ (`better-sqlite3` v13 is built for Node-API 10 and SIGSEGVs on 22.13 and below).
- Updated dependencies [940c4e5]
- Updated dependencies [a655537]
- Updated dependencies [0297727]
  - @truefoundry/trueforge-core@0.2.0-rc.0

## 0.1.4

### Patch Changes

- 42eee39: Enable a standalone in-memory local sandbox fallback (no settings row), persist fancy `v1:type:raw` sandbox ids, drop tenant-prefix ownership checks, keep TFY sandbox writes cwd-relative (no `/opt` / `/usr/local`), let each sandbox provider own PATH (no hardcoded Daytona tail in Sandbox), and grant only the Code Mode socket parent in SRT (not host `/tmp`).
- cc49d4a: Rename catalog, sandbox-file download, and MCP tools paths; Fern upsert becomes create_or_update. Sessions and turns default and max 25; session and turn event lists default and max 100.
- d7a640f: Align OpenAPI type names across AgentSpec, settings, catalogs, and chat pickers: Catalog/Configured/Available resource views, AgentSpec nested Model/Skill/InitialUserMessage, Put*Request → Update*Request, MCP acronym casing, GetMeResponse, and explicit names for nested AgentSpec/capabilities schemas.
- 6251d2a: Omit POST /api/v1/auth/logout from the SDK; the UI posts the cookie-clearing path directly.
- 2c3278e: Treat a replayed OIDC callback (browser Back after a successful login) as already signed-in instead of `/?error=login_failed`, and ignore that stale query when a session is still valid.
- 5e03c3d: Collapse Mintlify API Reference groups to Auth, Capabilities, Models, MCP Servers, Skills, Sandboxes, Agents, and Agent Sessions.
- Updated dependencies [42eee39]
- Updated dependencies [d7a640f]
- Updated dependencies [7ae5376]
- Updated dependencies [889caca]
- Updated dependencies [2ca7fb2]
- Updated dependencies [43d780e]
  - @truefoundry/trueforge-core@0.1.4

## 0.1.4-rc.0

### Patch Changes

- 42eee39: Enable a standalone in-memory local sandbox fallback (no settings row), persist fancy `v1:type:raw` sandbox ids, drop tenant-prefix ownership checks, keep TFY sandbox writes cwd-relative (no `/opt` / `/usr/local`), let each sandbox provider own PATH (no hardcoded Daytona tail in Sandbox), and grant only the Code Mode socket parent in SRT (not host `/tmp`).
- cc49d4a: Rename catalog, sandbox-file download, and MCP tools paths; Fern upsert becomes create_or_update. Sessions and turns default and max 25; session and turn event lists default and max 100.
- d7a640f: Align OpenAPI type names across AgentSpec, settings, catalogs, and chat pickers: Catalog/Configured/Available resource views, AgentSpec nested Model/Skill/InitialUserMessage, Put*Request → Update*Request, MCP acronym casing, GetMeResponse, and explicit names for nested AgentSpec/capabilities schemas.
- 6251d2a: Omit POST /api/v1/auth/logout from the SDK; the UI posts the cookie-clearing path directly.
- 2c3278e: Treat a replayed OIDC callback (browser Back after a successful login) as already signed-in instead of `/?error=login_failed`, and ignore that stale query when a session is still valid.
- 5e03c3d: Collapse Mintlify API Reference groups to Auth, Capabilities, Models, MCP Servers, Skills, Sandboxes, Agents, and Agent Sessions.
- Updated dependencies [42eee39]
- Updated dependencies [d7a640f]
- Updated dependencies [7ae5376]
- Updated dependencies [889caca]
- Updated dependencies [2ca7fb2]
- Updated dependencies [43d780e]
  - @truefoundry/trueforge-core@0.1.4-rc.0

## 0.1.3

### Patch Changes

- 3113aa4: Rename the MCP servers SDK method from `deleteAuthorize` to `deleteAuthorization`.
- 45dc6cd: Replace MCP authorize `redirect_url` with a same-origin `return_to` path to prevent open redirects after OAuth.
- c546350: Pass `tenantName` on `SandboxOptions` instead of injecting `TFY_TENANT_NAME` via exec env.
- Updated dependencies [08700d1]
- Updated dependencies [c546350]
  - @truefoundry/trueforge-core@0.1.3

## 0.1.2

### Patch Changes

- 9485811: Clear DCR OAuth tokens and pending authorizations when an MCP server URL changes, since the URL is the token audience.
- 5b981ab: Cancel a session even when the owning executor is gone (restart) or Redis cannot confirm abort. Freeze the running turn in the store so a new turn can start. `freezeAndGetTurn` now takes the cancellation reason (barge-in stays `cancelled-for-next-turn`; explicit cancel stays `client-cancelled`). Redis timeout and transport failures still freeze, with a warning that the cancel is not clean.
- Updated dependencies [363a522]
- Updated dependencies [5b981ab]
  - @truefoundry/trueforge-core@0.1.2

## 0.1.1

### Patch Changes

- 69237db: Await Daytona snapshot registration on sandbox provider configure so auth failures return 422 instead of a false pending status, and keep GET status refreshes persisted.
- f056973: Reject oversized HTTP request bodies with 413 via config-driven Hono bodyLimit (MAX_REQUEST_BODY_BYTES).
- 9a4d1a7: Add opt-in `withRouter` URL sync for shell places (`/`, `/agents/:agentName`, `/sessions/:sessionId`, `/settings`), with path customization via `routes` and `react-router-dom` as an optional peer. Serve the app shell for client-side deep links from the TrueForge server.
- Updated dependencies [69237db]
- Updated dependencies [7783fc0]
  - @truefoundry/trueforge-core@0.1.1

## 0.1.0

### Minor Changes

- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.

### Patch Changes

- e9bf976: Wrap settings MCP, skills, model-provider, and sandbox create/put bodies as `{ manifest }`. List/get items nest the stored document (`name` plus `manifest`, plus derived fields). Create returns 201. Chat lists and catalogs stay flat. Adapter catalogs follow the new SDK shapes.
- Updated dependencies [b56c003]
  - @truefoundry/trueforge-core@0.1.0

## 0.1.0-rc.1

### Patch Changes

- e9bf976: Wrap settings MCP, skills, model-provider, and sandbox create/put bodies as `{ manifest }`. List/get items nest the stored document (`name` plus `manifest`, plus derived fields). Create returns 201. Chat lists and catalogs stay flat. Adapter catalogs follow the new SDK shapes.

## 0.1.0-rc.0

### Minor Changes

- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.

### Patch Changes

- Updated dependencies [b56c003]
  - @truefoundry/trueforge-core@0.1.0-rc.0
