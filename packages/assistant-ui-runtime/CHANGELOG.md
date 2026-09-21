# Changelog

## 0.1.43

### Added

- `AgentRuntimeConfig.webSearch` and `AgentBuilderCapabilitiesResponse.data.webSearch` for host web-search capability gating.

## 0.1.42

### Added

- Optional `AgentChatServer.renameSession`. When present, thread-list adapters persist rename through it.

## 0.1.41

### Breaking

- `AgentChatServer.downloadSandboxFile` now receives `sandboxId?: string` (optional) instead of `sandboxId: string`. Host implementations must handle a missing `sandboxId`; turn-scoped hosts resolve the sandbox from `(sessionId, turnId)`.

### Fixed

- **Continuation turns no longer leak a local turn id** — approval / ask-user / MCP-auth resume turns now rename their placeholder id to the gateway-assigned id (`turn.created`), and fall back to the last committed turn's id instead of minting a fresh local one. Previously the fabricated id (e.g. `Vu3Hyio`) reached hosts via `custom.turnId`, breaking turn-scoped sandbox downloads ("Turn not found") and edit/retry.
- **Sandbox artifact download after resume** — `downloadSandboxFile` no longer hard-requires a client-known `sandboxId`. Turn-scoped hosts resolve the sandbox from `(sessionId, turnId)`; `sandboxId` is optional on the request and passed best-effort. Hydration forward-propagates the session-scoped `sandboxId` across turns in the loaded window (and backfills tip turns when older pages reveal `sandbox.created`), and downloads resolve the sandbox that was current as of the artifact's turn, paging in older history when its reference predates the loaded window.
- **Session switch no longer corrupts sandbox history page-in** — stale `loadOlderHistory` / `resolveSandboxIdForTurn` closures abort when the live session id changes, so a post-switch iteration cannot merge another session's pages onto the current snapshot.

## 0.1.39

### Breaking

- `ListPermissionsResponse.data` is now `{ type, permissions }` instead of a flat id→grants map.
- `PermissionResourceType` includes `tenant`; `ResourcePermission` includes `CREATE` (tenant entity-kind grants).

### Fixed

- Assistant messages use the turn completion time instead of the turn start time.
- Detaching from a turn stream (session switch, reload, remount) no longer cancels the backend run; only an explicit cancel does.

## 0.1.37

### Added

- Optional `description` on `AgentSelectorEntry` / `AgentLibraryEntry`, `AgentDetail`, and `SaveAgentRequest`.

### Changed

- The bundled Control Plane adapter maps description as a top-level library/save field and still writes it onto the CP `manifest.description` wire field.

## 0.1.36

### Added

- Optional `CreatedBySubject` on `AgentSelectorEntry` / `AgentLibraryEntry` and `Schedule` so hosts can surface a Created-by column.

## 0.1.33

### Breaking

- Removed `AgentBuilderServer.listMcp`; `getMcp` returns the complete MCP catalog.

## 0.1.30

### Changed

- `SessionListMetrics.totalCostInUsd` is optional so hosts can omit unavailable session costs.

## 0.1.29

### Added

- **`AgentBuilderServer.listMcp?(req?: PageParams): Promise<ListResult<TMcp>>`** — optional token-paginated MCP catalog for picker infinite scroll. Hosts that omit it keep using `getMcp()`.

## 0.1.28

### Added

- Optional `PermissionsServer` port for batch MANAGE/DELETE grants on agents, schedules, and sessions.

## 0.1.25

### Breaking

- **`ScheduleServer.listSchedules` returns `ListResult<TSchedule>`** instead of `TSchedule[]` (token pagination via `limit` / `pageToken` / `nextPageToken`).
- **`ListSchedulesParams`** adds optional `agentIds`, `limit`, and `pageToken` (still accepts single `agentId`).

### Added

- **`ScheduleRun` / `ScheduleRunStatus` / `CreateScheduleRunRequest`** — flat run DTOs for last-run chips and manual “run now”.
- **`ScheduleServer.listScheduleRuns` / `createScheduleRun`** — optional schedule-run surface for hosts that support manual triggers.
- Advanced agent configuration contracts for model limits, model parameters, runtime settings, and lazy MCP tool selection (`McpToolSelection`, optional `AgentBuilderServer.getMcpTools`).
- TrueForge builder adapter enrichment for model metadata and MCP tool discovery.
- `AgentInputTokensCompactionTrigger` and `AgentCompactionConfig` types.

## 0.1.18

### Added

- **`getModels` reasoning efforts** — `listEnabledModels` also fetches `/api/svc/v1/provider-accounts/providers` and sets `properties.reasoningEfforts` for thinking-capable models (same visibility rules as ai.tf: skip exact `openai` slug, require `thinking: true`, honor `removeParams`).

### Fixed

- **Extras ancestor walk vs RootAssistantClient** — `tryGetTrueForgeExtras` / `useTrueForgeRuntimeExtras` try/catch Proxy gets when walking `Object.create(parent)` AUI clients, so hitting the store’s RootAssistantClient prototype no longer throws `The current scope does not have a "subscribe" property`. `trueForgeExtras.get` / `.use` use the same walk (no nested-UI footgun).
- **`getModels` latency** — enabled-models and provider-metadata CP fetches run in parallel; providers soft-fails without blocking the model list.
- **Model selector `name` is model_fqn** — `normalizeEnabledModels` sets `ModelSelectorEntry.name` (and `id`) to `model_fqn`, so trueforge-ui’s DraftModelSelector writes `AgentSpec.model.name` as `account/model-id` instead of the short CP display label.
- **Gateway mount sanitization** — `normalizeMcpMount` / `normalizeSkillMount` rebuild allowlisted registry/git/inline shapes instead of blind-passthrough, so FE `id` / display `name` / registry `url` never leak onto draft create/update. Registry MCP mounts default `enableTools` to `["@all"]` when missing (narrow lists still preserved).

## 0.1.12

### Breaking

- **`SandboxCatalogServer` method renames (sandbox → sandbox provider)**
  `getSandboxCatalog` → `getSandboxProviderCatalog`, `listSandboxes` → `listSandboxProviders`, `createSandbox` → `createSandboxProvider`, `updateSandbox` → `updateSandboxProvider`, `deleteSandbox` → `deleteSandboxProvider?` (now optional). Host aliases (`SandboxProviderConfig`, `SandboxProviderCatalogEntry`, `SandboxProviderBase`, `CreateSandboxProviderRequest`, `UpdateSandboxProviderRequest`) map to the existing DTO names.

- **`SandboxBase` now extends `SandboxConfig`**
  Connected rows always carry last-saved provider settings so update forms can show previous values.

- **`UpdateSandboxRequest.apiKey` is optional**
  Omit to keep the existing key; send a value to rotate.

- **`ConnectorBase.tools` removed**
  Tools are no longer embedded on the connector row. Fetch with new required `ConnectorCatalogServer.getToolsByConnectorId({ id })`. `ConnectorBase` is no longer generic in `TTool`.

- **`ConnectorCatalogServer` adds required `getConnector` / `getToolsByConnectorId`**
  Implement both on every catalog adapter.

- **`authenticateConnector` request/return changed**
  Request is `AuthenticateConnectorRequest` (`id` + optional `returnTo`). Return is `TConnector | ConnectorAuthenticationResult<TConnector>` — either an authenticated connector (or one carrying `auth.authUrl`) or a result with `authorization_endpoint` for the popup flow.

- **`ConnectorAuthPublicOAuth.authUrl` is optional**
  Public dcr rows may omit `authUrl` when auth is started via `authorization_endpoint` instead. (Supersedes the 0.1.8 note that public dcr required `authUrl`.)

### Added

- **Sole ownership of server-port types** — this package is the canonical home for `AgentChatServer` / `AgentBuilderServer` / catalog ports and DTOs. Hosts (e.g. trueforge-ui) should re-export, not fork.
- **`AgentUIServer`** — host-facing alias of `AgentUIServerPort`.
- **Selector / compose aliases** — `ModelSelection`, `AgentSkill`, `ConnectorState`, `AgentLibraryEntry`, `SearchAgentsParams` (aliases of the `*SelectorEntry` / `SearchAgentSelectorParams` names).
- **Root exports** for builder/catalog types previously internal to `server/` (`SaveAgentRequest`, `AgentBuilderCapabilitiesResponse`, `AuthenticateConnectorRequest`, `ConnectorAuthenticationResult`, mounts, selector entries, sandbox-provider aliases, etc.).
- **`ModelSelectorEntry.providerLogo?`**, **`ConnectorSelectorEntry.requiresAuth?` / `authenticated?`**, **`ModelProviderCatalogEntry.supportedReasoningEfforts?` / `logo?`**, **`ConnectorCatalogEntry.logo?`**.
- **`SaveAgentRequest`** — named request body for `AgentBuilderServer.saveAgent`.
- **`createTrueForgeAgentUIServer.getCapabilities`** — returns sandbox / skill / settings enabled (stub; always `true` for this pack).
- **`PreviousTurnIdInput` documents `"none"`** alongside `"auto"` and turn ids.

### Fixed

- **`sessionToThreadMetadata`** — always stamps `custom.isMutable` from the session (plus `agentName` when present). History UIs can trust mutability without inferring it from `agentName`, so ref sessions whose agent was deleted stay immutable.

## 0.1.10

### Breaking

- **`ListSessionsParams.agentName` → `agentId`**
  Thread-list adapters and the TFY chat server forward the optional filter as `agentId`. Hosts that previously keyed list filters by name should pass that same value as `agentId` (or via `listSessionsAgentId` on the runtime / adapters).

- **Draft thread list no longer filters `isMutable` client-side**
  `createTrueForgeDraftThreadListAdapter.list` returns every session from `listSessions`. Title named (immutable) rows with `title → agentName → id`, not the draft model name.

### Added

- **`listSessionsAgentId?: string`** on `useTrueForgeAgentRuntime` and all three thread-list adapters (`createTrueForgeThreadListAdapter`, `createTrueForgeDraftThreadListAdapter`, `createTrueForgeOwnedSessionsThreadListAdapter`). Omit to list all chats; set to filter `listSessions({ agentId })`.
- **`AgentSelectorEntry.agentId?` / `agentSpec?`** — CP `normalizeAgents` fills these from agent id + `latestVersionDetails.manifest` so hosts can offer Edit when a published spec is present.
- **`agentSpecFromCpManifest` / `toCamelCaseDeep`** — map CP AgentManifest (snake_case) → FE `TfyAgentSpec` for Edit seeding, preserving agent `config` and mount `enableTools` / `preload` / `config`.
- **`sessionDisplayTitle` / `sessionToThreadMetadata`** — shared session → thread-list metadata helpers; named sessions expose `custom.agentName` when present.

### Fixed

- **Edit → Save round-trip** — catalog mounts from CP keep runtime fields; `normalizeMcpMount` / `normalizeSkillMount` forward `enableTools`, `preload`, and `config` so save no longer defaults MCP tools to `@all`, forces skill `preload: false`, or drops config.
- **Untitled named sessions in draft history** — mixed lists use `sessionDisplayTitle` so immutable rows fall back to `agentName` / `id` instead of `defaultAgentSpec.model.name`.

### Changed

- Bump `@assistant-ui/core` to `^0.2.22` and `@assistant-ui/store` to `^0.2.21`.

## 0.1.9

### Added

- **Sandboxes catalog** — new `SandboxCatalogServer` port and DTOs (`SandboxConfig`, `SandboxCatalogEntry`, `SandboxBase`, `CreateSandboxRequest`, `UpdateSandboxRequest`). Exposed as the optional `CatalogServer.sandboxCatalog` sub-port. `SandboxConfig` holds the mutable settings (`snapshotName`, `execTimeoutMs`, `autoStopIntervalInMinutes`, `autoArchiveIntervalInMinutes`, `autoDeleteIntervalInMinutes`) shared by catalog rows, create, and update; create adds `apiKey`.
- **Skills catalog** — `SkillCatalogServer.getSkillCatalog()` plus registry/github skill DTOs (`RegistrySkill`, `GithubSkill`, `DefinedSkill`, `SkillConfigBase`, `SkillCatalogEntry`, `CreateSkillRequestBase`, `SelectRegistrySkillRequest`, `ImportGithubSkillRequest`). Registry vs github is distinguished by `catalogId` presence, not a `type` field.
- **`ModelSelectorEntry.reasoningEfforts?: string[]`** and **`ToolBase.description: string`**.

## 0.1.8

### Breaking

- **`AgentChatServer.prepareAndExecuteTurn` → `createTurn`**
  Rename the method on every `AgentChatServer` implementation and mock. Signature and return type are unchanged.

- **`ConnectorAuthType` is now `"dcr" | "header" | "none"`**
  Previously an open `string` with documented display labels (`"None"`, `"OAuth"`, `"API Key"`). Map host/wire values to these literals.

- **`ConnectorAuth` / `ConnectorAuthPublic` are discriminated unions**
  - Write: `{ type: "dcr"; authUrl?: string } | { type: "header"; apiKey?: string; headerName?: string } | { type: "none" }`
  - Public: dcr branch requires `authUrl: string` (no secrets).
    Branch types (`ConnectorAuthOAuth`, `ConnectorAuthPublicOAuth`, …) are exported so hosts can intersect extras and re-union, e.g. `ConnectorAuthPublicOAuth & { custom: string }`.

- **`ConnectorBase.requiresAuth: boolean`**
  Required alongside existing `authenticated`. When `requiresAuth` is true, UI should not show Disconnect.

### Notes

- After `authenticateConnector`, the authorize URL is on `connector.auth.authUrl` when `auth.type === "dcr"` (not a separate widened return field).
