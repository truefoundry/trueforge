## [0.1.4-rc.1] - 2026-09-04

## [0.1.4-rc.0] - 2026-08-27

## 0.1.4-rc.1

### Patch Changes

- 648273b: Regenerate SDK from updated OpenAPI spec.
- 648273b: Regenerate SDK from updated OpenAPI spec.
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
