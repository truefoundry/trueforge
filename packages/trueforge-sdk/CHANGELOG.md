## [0.2.0-rc.5] - 2026-09-11

## [0.2.0-rc.4] - 2026-09-11

## 0.2.0-rc.5

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.
- 9501536: Make MCPServerManifest a type-discriminated oneOf of RemoteMCPServerManifest and TrueFoundryMCPServerManifest.
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
- 44f9cbe: TrueFoundry mode: env-backed Daytona | truefoundry sandbox via TRUEFOUNDRY_SANDBOX_* (static SETTINGS JSON). Settings OpenAPI stays Daytona-only (`SandboxProviderManifest`); truefoundry is store-internal (`StoredSandboxProviderManifest`).

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
- 4c1260e: Wire TrueFoundry MCP authorize, status, and delete through ServiceFoundry; stub list auth_status; gate oauth2 invoke mid-turn with authRequired; paginate MCP server lists. UI treats SFY consent `code`/`error` on the FE landing like local DCR success/failure.
- f175245: Add TrueFoundry-managed MCP list/get (SFY registry, gateway proxy URL, create/update 424).

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
