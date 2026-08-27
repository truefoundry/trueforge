# @truefoundry/trueforge

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
