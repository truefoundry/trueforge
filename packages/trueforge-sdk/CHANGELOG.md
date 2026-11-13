## [0.185.0] - 2026-11-13

## [0.185.0-rc.1] - 2026-11-11

## [0.184.0] - 2026-11-05

## [0.184.0-rc.1] - 2026-11-04

## [0.183.0] - 2026-11-03

## [0.183.0-rc.1] - 2026-11-02

## [0.183.0-rc.0] - 2026-11-02

## [0.182.0] - 2026-10-30

## [0.182.0-rc.1] - 2026-10-29

## [0.181.0] - 2026-10-28

## [0.181.0-rc.1] - 2026-10-26

## [0.180.0] - 2026-10-23

## [0.180.0-rc.0] - 2026-10-21

## [0.179.0] - 2026-10-14

## [0.179.0-rc.1] - 2026-10-13

## [0.178.0] - 2026-10-09

## [0.178.0-rc.2] - 2026-10-08

## [0.178.0-rc.1] - 2026-10-08

## [0.177.0] - 2026-10-07

## [0.177.0-rc.1] - 2026-10-05

## [0.0.0] - 2026-09-29

## [0.2.1] - 2026-09-29

## [0.2.1-rc.0] - 2026-09-22

## 0.185.0

### Patch Changes

- 5714397: Add a Memory toggle to the agent builder, shown once the tenant has a memory provider. In OSS, admins configure Zep in Settings → Memory (`/api/v1/settings/memory-providers`); in TrueFoundry mode it comes from `TRUEFOUNDRY_MEMORY_*` env. A tenant-wide memory switch, off by default, gates memory in chats, ingestion, and agent specs.
- 475c0c2: Add POST `/api/internal/sessions/{session_id}/turns` (service API key): non-streaming body, getSessionById, requires external_id + non-null source (skips memory ingest), SessionSource `service` arm.
- 1998de5: Turns now pause, instead of finishing, while waiting for user input such as tool approvals, questions, or MCP authentication. The same turn resumes once every required interaction is answered. Clients send those answers as events on the paused turn and can reconnect to its event stream at any point.
  
  - While a turn is paused, its cost and time so far stay visible. Time spent waiting on the user does not count. Cancelling a paused turn still shows its final cost and time.
  - Conversations that were already waiting on the user stay waiting after upgrade, with the same cost, time, and status.
  - The chat shows a waiting notice instead of a running indicator while a turn is paused or cannot continue.
  - A conversation is saved to memory only after it finishes, not while it is waiting on the user.
  - Creating a turn requires a user message. Omitting `input` or sending an empty message is rejected.
  - Sending a new message while a sub-agent is waiting runs that message, instead of leaving the turn stuck.
  - A conversation paused longer than the memory window is still saved once it finishes.
  - An old `pause_timeout_ms` memory setting is ignored, instead of stopping startup.
  
  Breaking changes for package consumers:
  
  - `@truefoundry/trueforge-assistant-ui-runtime`: `useTrueForgeResumeMcpAuth` is renamed to `useTrueForgeContinueMcpAuth`, and `findCurrentPausedAssistantMessage` to `findPausedAssistantMessage`. `collectRequiredActionInputs`, `collectApprovalInputs`, `toTrueForgeApprovalInputs`, `collectResponseInputs`, and `TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY` are removed; answer approvals and questions with `useTrueForgeRespondToToolApproval` and `useTrueForgeRespondToToolResponse` instead.
  - Custom chat servers must implement `sendTurnEvents` to deliver answers to a paused turn. `CreateTurnRequest.input` is required.
  - `@truefoundry/trueforge-ui`: `ToolApprovalContainer` takes `approvalId` and `onRespond` instead of `options` and `onSelectOption`.
- 8ef66cc: Replace the session sharing capability's enabled flag with required tenant or subject granularity across the API and UI contracts, and use subject granularity to enable user invitations.

## 0.185.0-rc.1

### Patch Changes

- 5714397: Add a Memory toggle to the agent builder, shown once the tenant has a memory provider. In OSS, admins configure Zep in Settings → Memory (`/api/v1/settings/memory-providers`); in TrueFoundry mode it comes from `TRUEFOUNDRY_MEMORY_*` env. A tenant-wide memory switch, off by default, gates memory in chats, ingestion, and agent specs.
- 475c0c2: Add POST `/api/internal/sessions/{session_id}/turns` (service API key): non-streaming body, getSessionById, requires external_id + non-null source (skips memory ingest), SessionSource `service` arm.
- 1998de5: Turns now pause, instead of finishing, while waiting for user input such as tool approvals, questions, or MCP authentication. The same turn resumes once every required interaction is answered. Clients send those answers as events on the paused turn and can reconnect to its event stream at any point.
  
  - While a turn is paused, its cost and time so far stay visible. Time spent waiting on the user does not count. Cancelling a paused turn still shows its final cost and time.
  - Conversations that were already waiting on the user stay waiting after upgrade, with the same cost, time, and status.
  - The chat shows a waiting notice instead of a running indicator while a turn is paused or cannot continue.
  - A conversation is saved to memory only after it finishes, not while it is waiting on the user.
  - Creating a turn requires a user message. Omitting `input` or sending an empty message is rejected.
  - Sending a new message while a sub-agent is waiting runs that message, instead of leaving the turn stuck.
  - A conversation paused longer than the memory window is still saved once it finishes.
  - An old `pause_timeout_ms` memory setting is ignored, instead of stopping startup.
  
  Breaking changes for package consumers:
  
  - `@truefoundry/trueforge-assistant-ui-runtime`: `useTrueForgeResumeMcpAuth` is renamed to `useTrueForgeContinueMcpAuth`, and `findCurrentPausedAssistantMessage` to `findPausedAssistantMessage`. `collectRequiredActionInputs`, `collectApprovalInputs`, `toTrueForgeApprovalInputs`, `collectResponseInputs`, and `TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY` are removed; answer approvals and questions with `useTrueForgeRespondToToolApproval` and `useTrueForgeRespondToToolResponse` instead.
  - Custom chat servers must implement `sendTurnEvents` to deliver answers to a paused turn. `CreateTurnRequest.input` is required.
  - `@truefoundry/trueforge-ui`: `ToolApprovalContainer` takes `approvalId` and `onRespond` instead of `options` and `onSelectOption`.
- 8ef66cc: Replace the session sharing capability's enabled flag with required tenant or subject granularity across the API and UI contracts, and use subject granularity to enable user invitations.

## 0.184.0

### Patch Changes

- f3998c9: Gate Environments chrome and CRUD on provider env support: hide UI and return 422 when the shared sandbox has no snapshot/env concept. Capabilities expose `sandbox.environments.enabled` for that gate.
- 1b30b71: Add a tenant-wide web search switch stored in the new `configuration` table, with `GET` and `PATCH /api/v1/settings/configuration` behind an admin gate. Capabilities and session or agent writes follow it, so web search cannot be turned on while the switch is off; a spec that already has it on keeps it, which also leaves existing agents and their schedules running. The `settings` capability now reports one entry per settings section with its own `enabled` and `manage_providers`. Catalog settings routes that the deployment does not own answer 422 naming the route, where they previously answered 403.

## 0.184.0-rc.1

### Patch Changes

- f3998c9: Gate Environments chrome and CRUD on provider env support: hide UI and return 422 when the shared sandbox has no snapshot/env concept. Capabilities expose `sandbox.environments.enabled` for that gate.
- 1b30b71: Add a tenant-wide web search switch stored in the new `configuration` table, with `GET` and `PATCH /api/v1/settings/configuration` behind an admin gate. Capabilities and session or agent writes follow it, so web search cannot be turned on while the switch is off; a spec that already has it on keeps it, which also leaves existing agents and their schedules running. The `settings` capability now reports one entry per settings section with its own `enabled` and `manage_providers`. Catalog settings routes that the deployment does not own answer 422 naming the route, where they previously answered 403.

## 0.183.0

### Patch Changes

- 61872ac: Add a tenant-wide web search switch stored in the new `configuration` table, with `GET` and `PATCH /api/v1/settings/configuration` behind an admin gate. Capabilities and session or agent writes follow it, so web search cannot be turned on while the switch is off; a spec that already has it on keeps it, which also leaves existing agents and their schedules running. The `settings` capability now reports one entry per settings section with its own `enabled` and `manage_providers`. Catalog settings routes that the deployment does not own answer 422 naming the route, where they previously answered 403.

## 0.183.0-rc.1

### Patch Changes

- 61872ac: Add a tenant-wide web search switch stored in the new `configuration` table, with `GET` and `PATCH /api/v1/settings/configuration` behind an admin gate. Capabilities and session or agent writes follow it, so web search cannot be turned on while the switch is off; a spec that already has it on keeps it, which also leaves existing agents and their schedules running. The `settings` capability now reports one entry per settings section with its own `enabled` and `manage_providers`. Catalog settings routes that the deployment does not own answer 422 naming the route, where they previously answered 403.

## 0.182.0

### Patch Changes

- cf786ee: Enable Fern `outputEsm` so the SDK package is `"type": "module"` and `trueforge-dev` star re-exports resolve for workspace ESM importers.

## 0.182.0-rc.1

### Patch Changes

- cf786ee: Enable Fern `outputEsm` so the SDK package is `"type": "module"` and `trueforge-dev` star re-exports resolve for workspace ESM importers.

## 0.181.0

### Patch Changes

- 5bb093e: Regenerate SDK from updated OpenAPI spec.
- 90c7b1c: Unify admin checks with `hasAdminRole` (tenant-admin in TrueFoundry) and gate sandbox environment create to admins while allowing the creator or an admin to update or delete. Expose schedule and sandbox environment `MANAGE`/`DELETE` (and tenant `sandbox_environment` `CREATE`) via list-permissions so the UI matches the API; settings access remains disabled in TrueFoundry via `canAccessSettings`.

## 0.181.0-rc.1

### Patch Changes

- 5bb093e: Regenerate SDK from updated OpenAPI spec.
- 90c7b1c: Unify admin checks with `hasAdminRole` (tenant-admin in TrueFoundry) and gate sandbox environment create to admins while allowing the creator or an admin to update or delete. Expose schedule and sandbox environment `MANAGE`/`DELETE` (and tenant `sandbox_environment` `CREATE`) via list-permissions so the UI matches the API; settings access remains disabled in TrueFoundry via `canAccessSettings`.

## 0.180.0

No changes in this release.

## 0.179.0

### Patch Changes

- 694a572: Reject duplicate sandbox environment names on create (POST) instead of overwriting via upsert.

## 0.179.0-rc.1

### Patch Changes

- 694a572: Reject duplicate sandbox environment names on create (POST) instead of overwriting via upsert.

## 0.178.0

### Patch Changes

- 8c24138: Regenerate SDK from updated OpenAPI spec.
- 9bb142d: Reject duplicate sandbox environment names on create (POST) instead of overwriting via upsert.

## 0.178.0-rc.2

### Patch Changes

- 9bb142d: Reject duplicate sandbox environment names on create (POST) instead of overwriting via upsert.

## 0.178.0-rc.1

### Patch Changes

- 8c24138: Regenerate SDK from updated OpenAPI spec.

## 0.177.0

### Patch Changes

- 5b7abb6: Regenerate SDK from updated OpenAPI spec.

## 0.177.0-rc.1

### Patch Changes

- 5b7abb6: Regenerate SDK from updated OpenAPI spec.

## 0.2.1

### Patch Changes

- 829ac6e: Regenerate SDK from updated OpenAPI spec.
- 829ac6e: Regenerate SDK from updated OpenAPI spec.
- 829ac6e: Regenerate SDK from updated OpenAPI spec.
- 33cbe52: Default MCP tool approval to `@write` and `@destructive` again. Unlabeled tools still run without a pause unless named or covered by `@all`.
- 829ac6e: Regenerate SDK from updated OpenAPI spec.

## [0.2.0] - 2026-09-18

## 0.2.1-rc.0

### Patch Changes

- 829ac6e: Regenerate SDK from updated OpenAPI spec.

## [0.2.0-rc.9] - 2026-09-17

## 0.2.0

### Minor Changes

- 74eae6c: Remove pagination from list MCP servers across the API, SDK, and UI; return and search the complete configured MCP catalog client-side.

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 2dcb3a0: Add `created_by_me` to list sessions and list schedules so callers can restrict results to resources they created (excluding managed-agent visibility).
- a000b47: List sessions accepts `metadata[key]=value` query params (OpenAPI deepObject) for exact metadata containment filtering. Bare JSON-string `metadata` query params are rejected. Metadata keys are limited to 32 characters and cannot include `[]` or whitespace so they do not collide with the bracket query form.
- 9501536: [truefoundry] Make MCPServerManifest a type-discriminated oneOf of RemoteMCPServerManifest and TrueFoundryMCPServerManifest.
- 0ec8dc6: Omit session `total_cost_in_usd` when cost is unavailable (instead of defaulting to 0), matching turn metrics.
- dc2151f: Paginate `GET /api/v1/agents` with `limit` / `page_token` and a `pagination` envelope; optional `agent_name` filters by case-insensitive substring. Agents library uses rows-per-page and prev/next against the token-paginated API. Schedule create and the schedules listing agent filter use a searchable agent combobox backed by the same filtered list API.
- 134dcb9: Python SDK `is_event_delta` / `merge_event_delta` (PyPI version locksteps with this package on Version Packages).
- 52987a7: Add `internal.agents.getCodeSnippets` API under the new SDK `internal` namespace.
- 38ce068: Add tenant-unique optional session `external_id`, `Sessions.getOrCreateByExternalId`, and an idempotent `POST /internal/sessions/get-or-create-by-external-id` endpoint and SDK method.
- b654052: Add caller-owned session `metadata` (`Record<string, string>` with size limits) on create, update, and read. Persist as a new `session.metadata` jsonb column; leave session `custom` unchanged.
- 11865b4: Add optional session `source`. Persist as nullable JSONB with a list filter index; expose on session responses and list via `source_type` / `source_id`. Schedule dispatch sets source on create; public create/update do not accept it.
- 4c1260e: [truefoundry] Wire TrueFoundry MCP authorize, status, and delete through ServiceFoundry; stub list auth_status; gate oauth2 invoke mid-turn with authRequired; paginate MCP server lists. UI treats SFY consent `code`/`error` on the FE landing like local DCR success/failure.
- 44f9cbe: [truefoundry] TrueFoundry mode: env-backed Daytona | truefoundry sandbox via TRUEFOUNDRY_SANDBOX_* (static SETTINGS JSON). Settings OpenAPI stays Daytona-only (`SandboxProviderManifest`); truefoundry is store-internal (`StoredSandboxProviderManifest`).
- f175245: [truefoundry] Add TrueFoundry-managed MCP list/get (SFY registry, gateway proxy URL, create/update 424).

## [0.2.0-rc.8] - 2026-09-15

## 0.2.0-rc.9

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.

## [0.2.0-rc.7] - 2026-09-14

## 0.2.0-rc.8

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.
- 134dcb9: Python SDK `is_event_delta` / `merge_event_delta` (PyPI version locksteps with this package on Version Packages).

## [0.2.0-rc.6] - 2026-09-14

## 0.2.0-rc.7

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.

## [0.2.0-rc.5] - 2026-09-11

## 0.2.0-rc.6

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.

## [0.2.0-rc.4] - 2026-09-11

## 0.2.0-rc.5

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.
- 9501536: [truefoundry] Make MCPServerManifest a type-discriminated oneOf of RemoteMCPServerManifest and TrueFoundryMCPServerManifest.
- dc2151f: Paginate `GET /api/v1/agents` with `limit` / `page_token` and a `pagination` envelope; optional `agent_name` filters by case-insensitive substring. Agents library uses rows-per-page and prev/next against the token-paginated API. Schedule create and the schedules listing agent filter use a searchable agent combobox backed by the same filtered list API.

## [0.2.0-rc.3] - 2026-09-10

## 0.2.0-rc.4

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.

## [0.1.4-rc.2] - 2026-09-08

## 0.2.0-rc.3

### Minor Changes

- 74eae6c: Remove pagination from list MCP servers across the API, SDK, and UI; return and search the complete configured MCP catalog client-side.

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 44f9cbe: [truefoundry] TrueFoundry mode: env-backed Daytona | truefoundry sandbox via TRUEFOUNDRY_SANDBOX_* (static SETTINGS JSON). Settings OpenAPI stays Daytona-only (`SandboxProviderManifest`); truefoundry is store-internal (`StoredSandboxProviderManifest`).

## [0.1.4-rc.1] - 2026-09-07

## 0.1.4-rc.2

### Patch Changes

- a000b47: List sessions accepts `metadata[key]=value` query params (OpenAPI deepObject) for exact metadata containment filtering. Bare JSON-string `metadata` query params are rejected. Metadata keys are limited to 32 characters and cannot include `[]` or whitespace so they do not collide with the bracket query form.
- 0ec8dc6: Omit session `total_cost_in_usd` when cost is unavailable (instead of defaulting to 0), matching turn metrics.
- 11865b4: Add optional session `source`. Persist as nullable JSONB with a list filter index; expose on session responses and list via `source_type` / `source_id`. Schedule dispatch sets source on create; public create/update do not accept it.

## [0.1.4-rc.0] - 2026-08-27

## 0.1.4-rc.1

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
- 2dcb3a0: Add `created_by_me` to list sessions and list schedules so callers can restrict results to resources they created (excluding managed-agent visibility).
- 52987a7: Add `internal.agents.getCodeSnippets` API under the new SDK `internal` namespace.
- 38ce068: Add tenant-unique optional session `external_id`, `Sessions.getOrCreateByExternalId`, and an idempotent `POST /internal/sessions/get-or-create-by-external-id` endpoint and SDK method.
- b654052: Add caller-owned session `metadata` (`Record<string, string>` with size limits) on create, update, and read. Persist as a new `session.metadata` jsonb column; leave session `custom` unchanged.
- 4c1260e: [truefoundry] Wire TrueFoundry MCP authorize, status, and delete through ServiceFoundry; stub list auth_status; gate oauth2 invoke mid-turn with authRequired; paginate MCP server lists. UI treats SFY consent `code`/`error` on the FE landing like local DCR success/failure.
- f175245: [truefoundry] Add TrueFoundry-managed MCP list/get (SFY registry, gateway proxy URL, create/update 424).

## [0.1.3] - 2026-08-19

## 0.1.4-rc.0

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.

## [0.1.3-rc.0] - 2026-08-19

## 0.1.3

### Patch Changes

- cc49d4a: Regenerate SDK from updated OpenAPI spec.

## [0.1.2] - 2026-08-18

## 0.1.3-rc.0

### Patch Changes

- cc49d4a: Regenerate SDK from updated OpenAPI spec.

## [0.1.1] - 2026-08-17

## 0.1.2

### Patch Changes

- 3113aa4: Regenerate SDK from updated OpenAPI spec.
- 45dc6cd: Replace MCP authorize `redirect_url` with a same-origin `return_to` path to prevent open redirects after OAuth.

## [0.1.0] - 2026-08-16

## 0.1.1

### Patch Changes

- 5100c59: Regenerate SDK from updated OpenAPI spec.

## [0.1.0-rc.1] - 2026-08-14

## 0.1.0

### Minor Changes

- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.

### Patch Changes

- e9bf976: Wrap settings MCP, skills, model-provider, and sandbox create/put bodies as `{ manifest }`. List/get items nest the stored document (`name` plus `manifest`, plus derived fields). Create returns 201. Chat lists and catalogs stay flat. Adapter catalogs follow the new SDK shapes.

## [0.1.0-rc.0] - 2026-08-13

## 0.1.0-rc.1

### Patch Changes

- e9bf976: Wrap settings MCP, skills, model-provider, and sandbox create/put bodies as `{ manifest }`. List/get items nest the stored document (`name` plus `manifest`, plus derived fields). Create returns 201. Chat lists and catalogs stay flat. Adapter catalogs follow the new SDK shapes.

# @truefoundry/trueforge-sdk

## 0.1.0-rc.0

### Minor Changes

- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.
