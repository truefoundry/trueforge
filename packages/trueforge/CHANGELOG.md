# @truefoundry/trueforge

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
