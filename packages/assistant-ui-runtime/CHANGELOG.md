# @truefoundry/trueforge-assistant-ui-runtime

## 0.185.0-rc.2

### Patch Changes

- c5dea02: Prefer tool-approval chrome over MCP auth when both are pending, keep Connect/ask-user/custom prompts usable while siblings run without inventing paused turnState on later content, dismiss Continue without a blank Working gap, and show Cancelling feedback on the composer stop button.
- c5dea02: Show why a chat turn stopped: readable reasons for stopped, timed-out, and interrupted turns, hidden only when a newer message replaced the turn.
- c5dea02: The built-in TrueForge MCP now uses the same id and name, `trueforge:mcp`, and labels its tools as `truefoundry-system` instead of `mcp`.

## 0.185.0-rc.1

### Patch Changes

- 5714397: Add a Memory toggle to the agent builder, shown once the tenant has a memory provider. In OSS, admins configure Zep in Settings → Memory (`/api/v1/settings/memory-providers`); in TrueFoundry mode it comes from `TRUEFOUNDRY_MEMORY_*` env. A tenant-wide memory switch, off by default, gates memory in chats, ingestion, and agent specs.
- 11c7a95: Fill the first-chat sidebar title from GET /sessions via generateTitle instead of a rename PATCH that Ask TFY rejects.
- 660f649: Remove the deprecated session `shared` field and PATCH sharing flow in favor of access grants, and drop the unused `session.shared` database column. Rename the exported `CreatedBySubject` schema/type to `Subject` without changing creator fields. These API and type removals are breaking changes for consumers.
- 57ef77a: Make the list session events and list turn events page size configurable.

  - `LIST_EVENTS_PAGE_LIMIT_MAX` (default 100) sets the default and max `limit` for `GET /sessions/{session_id}/events` and `GET /sessions/{session_id}/turns/{turn_id}/events`. Larger values return 400.
  - The `listEvents`, `listTurnEvents`, and `listSessionEvents` server ports no longer take `limit`; the server setting controls the page size.

- 236d74b: Group tools issued in the same model step under an “N tool calls in parallel” row in Agent steps (including nested sub-agent transcripts). Sub-agent steps now draw a tree branch per step instead of a plain vertical line.
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

- 5e1e78f: Let admins turn sandbox environments off and choose which one is the default.

  - Sandbox environments carry `enabled` and `is_default`, changed through `PATCH /api/v1/sandbox-environments/{name}` with those fields. PUT still only updates the definition and creates a version.
  - A disabled environment stays listed and keeps working for chats and agents that already name it, but cannot be newly selected. It also cannot be made the default.
  - Saving an agent is the exception: create and update return 422 while the named environment is disabled, even if the agent already named it, so an edit cannot leave an agent pointing at an environment nobody may select. Running an agent that already names one is unaffected.
  - Setting `is_default` reads the target's `enabled` flag under the same lock that guards the write, so a disable committed just beforehand can no longer hand the default slot to a disabled environment and drop the previous default.
  - A draft keeps an environment that is still building or whose last build failed, instead of being moved to the tenant default. Only an environment that has left the catalog or been disabled is replaced, since those are the ones no chat may run on.
  - Choosing the default is admin-only, since every chat or agent that names no environment follows it. Enabling and disabling a single environment stays open to its creator.
  - Disabling the default releases the default slot, leaving the tenant without one until another is chosen. Bootstrap only claims the slot when it first creates the environment, so a cleared default is not restored on restart.
  - New chats and agents start with the environment flagged as default already selected by name, so a later change of default does not move work that was already started. With no default, they start with no environment.
  - API callers that omit the environment still resolve the flagged default at request time, rather than the environment named `trueforge-sandbox-env`.
  - The default environment cannot be deleted; delete returns 409 on the flagged row.
  - The reserved platform-provisioned environment (named `trueforge-sandbox-env`) can only be turned on or off: delete returns 409 on it and create/update reject the reserved name.
  - The environment pickers list every environment. Ones that cannot be picked - disabled, still building, or failed - are greyed out and say why on hover. A remembered environment that has left the catalog is repointed at the default.
  - `capabilities.sandbox.enabled` now reflects any enabled, ready environment instead of only the one named `trueforge-sandbox-env`.
  - Enabling, disabling, or changing the default no longer moves an environment's `updated_at`, which tracks edits to its definition.
  - Hovering the `Default` badge on the Envs page explains that agents without an environment run in that one.
  - The row actions menu on the Envs page always lists Edit, Set as default, Enable/Disable, and Delete. Ones that do not apply to that row are greyed out and say why on hover, instead of disappearing.
  - With no selectable environment, the new-chat and agent-builder pickers say none exist instead of offering a `Default` entry that resolves to nothing.

- 8ef66cc: Replace the session sharing capability's enabled flag with required tenant or subject granularity across the API and UI contracts, and use subject granularity to enable user invitations.
- 2343fe7: Treat empty create_sub_agent tool.response as a completed tool call so finished sub-agent cards stop showing Working… while sibling agents are still running.

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

- ecb51f7: Share sessions with specific users when capabilities report `session_sharing.users`: Harness implements the session access port (invite search, grants, revoke); tenant-wide access still uses the session `shared` flag.
- 61872ac: Add a tenant-wide web search switch stored in the new `configuration` table, with `GET` and `PATCH /api/v1/settings/configuration` behind an admin gate. Capabilities and session or agent writes follow it, so web search cannot be turned on while the switch is off; a spec that already has it on keeps it, which also leaves existing agents and their schedules running. The `settings` capability now reports one entry per settings section with its own `enabled` and `manage_providers`. Catalog settings routes that the deployment does not own answer 422 naming the route, where they previously answered 403.

## 0.183.0-rc.2

### Patch Changes

- 61872ac: Add a tenant-wide web search switch stored in the new `configuration` table, with `GET` and `PATCH /api/v1/settings/configuration` behind an admin gate. Capabilities and session or agent writes follow it, so web search cannot be turned on while the switch is off; a spec that already has it on keeps it, which also leaves existing agents and their schedules running. The `settings` capability now reports one entry per settings section with its own `enabled` and `manage_providers`. Catalog settings routes that the deployment does not own answer 422 naming the route, where they previously answered 403.

## 0.183.0-rc.1

### Patch Changes

- ecb51f7: Share sessions with specific users when capabilities report `session_sharing.users`: Harness implements the session access port (invite search, grants, revoke); tenant-wide access still uses the session `shared` flag.

## 0.182.0

### Patch Changes

- 48efe38: Show context compaction in chat agent steps as Summarizing/Summarized context with expandable event JSON, and mark Summary on the session event timeline.
- cc28923: Stamp `tfg.source: ui` metadata on UI-created sessions and filter Chat History on it so scheduled sessions are hidden by default.
- 834d1f6: Show the model catalog warning in the composer and agent-config model pickers when reasoning effort or context length is not configured.
- ee31bcd: Fix older chat history not rendering when a session event page ends mid-turn: the split turn is now held and joined with the next older page instead of being dropped.
- ae7c705: Share sessions with specific users when capabilities report `session_sharing.users`: Harness implements the session access port (invite search, grants, revoke); tenant-wide access still uses the session `shared` flag.
- ac5c91f: Render in-progress tip turns in session detail from already-loaded events and show that the turn may still be incomplete.

## 0.182.0-rc.2

### Patch Changes

- ae7c705: Share sessions with specific users when capabilities report `session_sharing.users`: Harness implements the session access port (invite search, grants, revoke); tenant-wide access still uses the session `shared` flag.

## 0.182.0-rc.1

### Patch Changes

- 48efe38: Show context compaction in chat agent steps as Summarizing/Summarized context with expandable event JSON, and mark Summary on the session event timeline.
- cc28923: Stamp `tfg.source: ui` metadata on UI-created sessions and filter Chat History on it so scheduled sessions are hidden by default.
- 834d1f6: Show the model catalog warning in the composer and agent-config model pickers when reasoning effort or context length is not configured.
- ee31bcd: Fix older chat history not rendering when a session event page ends mid-turn: the split turn is now held and joined with the next older page instead of being dropped.
- ac5c91f: Render in-progress tip turns in session detail from already-loaded events and show that the turn may still be incomplete.

## 0.181.0

### Patch Changes

- 9bed345: Emit `thread.context_compaction_started` / `thread.context_compaction_finished` around context compaction (trigger, usage, duration_ms).
- 2b88c4b: Paint a loaded session from its events window before confirming the tip, and stop fetching the oldest turn to decide whether that tip is still running. A send that applies its message in that window is kept, a send that fails before then still lets the load finish, and a tip that finishes before its done event is still shown.
- 90c7b1c: Unify admin checks with `hasAdminRole` (tenant-admin in TrueFoundry) and gate sandbox environment create to admins while allowing the creator or an admin to update or delete. Expose schedule and sandbox environment `MANAGE`/`DELETE` (and tenant `sandbox_environment` `CREATE`) via list-permissions so the UI matches the API; settings access remains disabled in TrueFoundry via `canAccessSettings`.
- 36f95f5: Open the linked session in the Sessions page when clicking a schedule run on the Schedules page.
- 457d16e: Show the model name in each turn header of the session view.
- 28f5105: Stop showing a "cancelled" banner on a turn that paused for user input when the user sends a new message instead of answering.

## 0.181.0-rc.1

### Patch Changes

- 9bed345: Emit `thread.context_compaction_started` / `thread.context_compaction_finished` around context compaction (trigger, usage, duration_ms).
- 2b88c4b: Paint a loaded session from its events window before confirming the tip, and stop fetching the oldest turn to decide whether that tip is still running. A send that applies its message in that window is kept, a send that fails before then still lets the load finish, and a tip that finishes before its done event is still shown.
- 90c7b1c: Unify admin checks with `hasAdminRole` (tenant-admin in TrueFoundry) and gate sandbox environment create to admins while allowing the creator or an admin to update or delete. Expose schedule and sandbox environment `MANAGE`/`DELETE` (and tenant `sandbox_environment` `CREATE`) via list-permissions so the UI matches the API; settings access remains disabled in TrueFoundry via `canAccessSettings`.
- 36f95f5: Open the linked session in the Sessions page when clicking a schedule run on the Schedules page.
- 457d16e: Show the model name in each turn header of the session view.
- 28f5105: Stop showing a "cancelled" banner on a turn that paused for user input when the user sends a new message instead of answering.

## 0.180.0

### Patch Changes

- 5d9b938: Paint a loaded session from its events window before confirming the tip, and stop fetching the oldest turn to decide whether that tip is still running. A send that applies its message in that window is kept, a send that fails before then still lets the load finish, and a tip that finishes before its done event is still shown.
- aa58442: Reject folder drops in chat attachments so they cannot block message send.
- c6ef7d1: Adopt the loaded session agent spec when resuming chat history so New Chat draft edits no longer PATCH over the saved sandbox environment; lock composer environment selection after a session exists; read/write sandbox `environmentName` so resumed chats show the correct environment; and keep showing a deleted environment from the agent spec.
- 5c22006: Show the session creator avatar in the sessions list meta row, with the subject name on hover.
- e4caefb: Surface cancelled turn reasons and failed sub-agents on the Agent Sessions timeline and metrics; project unfinished nested sub-agents as cancelled when the parent turn is already terminal, remap abort-shaped child thread.done errors (e.g. LLM stream aborted) to cancelled on cancelled turns, and close unfinished sub-agent chart bars at turn.done when thread.done is missing.

## 0.180.0-rc.2

### Patch Changes

- 5d9b938: Paint a loaded session from its events window before confirming the tip, and stop fetching the oldest turn to decide whether that tip is still running. A send that applies its message in that window is kept, a send that fails before then still lets the load finish, and a tip that finishes before its done event is still shown.

## 0.180.0-rc.1

### Patch Changes

- aa58442: Reject folder drops in chat attachments so they cannot block message send.
- c6ef7d1: Adopt the loaded session agent spec when resuming chat history so New Chat draft edits no longer PATCH over the saved sandbox environment; lock composer environment selection after a session exists; read/write sandbox `environmentName` so resumed chats show the correct environment; and keep showing a deleted environment from the agent spec.
- 5c22006: Show the session creator avatar in the sessions list meta row, with the subject name on hover.
- e4caefb: Surface cancelled turn reasons and failed sub-agents on the Agent Sessions timeline and metrics; project unfinished nested sub-agents as cancelled when the parent turn is already terminal, remap abort-shaped child thread.done errors (e.g. LLM stream aborted) to cancelled on cancelled turns, and close unfinished sub-agent chart bars at turn.done when thread.done is missing.

## 0.179.0

### Patch Changes

- 1513e91: Show cancelled turn reasons in chat and session detail via an orange cancelled banner, projecting the wire reason on message metadata from turn.done (including live commits).
- f5672f1: Show MCP auth resume turn boundaries and unanswered ask_user prompts in Sessions view.
- f0aa52d: Adopt the loaded session agent spec when resuming chat history so New Chat draft edits no longer PATCH over the saved sandbox environment; lock composer environment selection after a session exists; read/write sandbox `environmentName` so resumed chats show the correct environment; and keep showing a deleted environment from the agent spec.
- 694a572: Reject duplicate sandbox environment names on create (POST) instead of overwriting via upsert.
- bbe23c8: Surface cancelled turn reasons and failed sub-agents on the Agent Sessions timeline and metrics; project unfinished nested sub-agents as cancelled when the parent turn is already terminal, remap abort-shaped child thread.done errors (e.g. LLM stream aborted) to cancelled on cancelled turns, and close unfinished sub-agent chart bars at turn.done when thread.done is missing.

## 0.179.0-rc.2

### Patch Changes

- f0aa52d: Adopt the loaded session agent spec when resuming chat history so New Chat draft edits no longer PATCH over the saved sandbox environment; lock composer environment selection after a session exists; read/write sandbox `environmentName` so resumed chats show the correct environment; and keep showing a deleted environment from the agent spec.
- bbe23c8: Surface cancelled turn reasons and failed sub-agents on the Agent Sessions timeline and metrics; project unfinished nested sub-agents as cancelled when the parent turn is already terminal, remap abort-shaped child thread.done errors (e.g. LLM stream aborted) to cancelled on cancelled turns, and close unfinished sub-agent chart bars at turn.done when thread.done is missing.

## 0.179.0-rc.1

### Patch Changes

- 1513e91: Show cancelled turn reasons in chat and session detail via an orange cancelled banner, projecting the wire reason on message metadata from turn.done (including live commits).
- f5672f1: Show MCP auth resume turn boundaries and unanswered ask_user prompts in Sessions view.
- 694a572: Reject duplicate sandbox environment names on create (POST) instead of overwriting via upsert.

## 0.178.0

### Patch Changes

- e452b06: Preserve token and cost metrics on failed and cancelled turns in the UI adapter and types so turn headers and session totals include billable usage from non-done terminal turns.
- 68ea7ae: On refresh mid-turn, keep already-ingested running-tip model messages in live resume instead of hiding them behind the group baseline.
- 9bb142d: Reject duplicate sandbox environment names on create (POST) instead of overwriting via upsert.
- 6d91541: Display session metadata at the top of the session detail header
- d01ddc0: Reattach a live turn via subscribe after create/subscribe SSE drops, using the last ingested sequence number so the composer stays running instead of toasting a network error.

## 0.178.0-rc.2

### Patch Changes

- 9bb142d: Reject duplicate sandbox environment names on create (POST) instead of overwriting via upsert.

## 0.178.0-rc.1

### Patch Changes

- e452b06: Preserve token and cost metrics on failed and cancelled turns in the UI adapter and types so turn headers and session totals include billable usage from non-done terminal turns.
- 68ea7ae: On refresh mid-turn, keep already-ingested running-tip model messages in live resume instead of hiding them behind the group baseline.
- 6d91541: Display session metadata at the top of the session detail header
- d01ddc0: Reattach a live turn via subscribe after create/subscribe SSE drops, using the last ingested sequence number so the composer stays running instead of toasting a network error.

## 0.177.0

### Patch Changes

- d4bf49c: Clear `isRunning` and aborted stream controllers when a superseding send fails prior to starting `runStream`, and ensure `cancel()` clears `isRunning` after draining the in-flight run.
- d4bf49c: Keep the composer interactive during running and paused turns: Cancel only when empty, Send supersedes the prior client stream without cancelSession (preserving superseded in-flight turns in the transcript), and stacked pause chrome is abandoned after a later user message. Hosts that override ComposerSendButton and still branch only on isRunning should update to use hasContent.
- 2b76ce3: Add Environments page for sandbox environment CRUD (`/environments`), with UI Form and YAML editors, sidebar Envs nav, and a SandboxEnvironmentServer port.
- 5b7abb6: Avoid throwing agentSpec error when switching chats or rendering immutable sessions in Chat History.
- b9429a0: Preserve token and cost metrics on failed and cancelled turns in the UI adapter and types so turn headers and session totals include billable usage from non-done terminal turns.
- 5b7abb6: Prevent duplicate assistant message IDs when a turn stream finishes on mcp.auth_required without model messages.
- fc99f4e: On refresh mid-turn, keep already-ingested running-tip model messages in live resume instead of hiding them behind the group baseline.
- 6813758: On refresh mid-turn, baseline all prior root model messages for a new user tip so the previous turn's content does not leak into the resumed stream.
- 5b7abb6: Add sandbox-environment CRUD (tables, PUT upsert, subject ownership, soft-delete). Versions land as `pending` for a future controller. AgentSpec `config.sandbox.environment_name` names a caller-owned env; name `default` is reserved; delete returns 409 while agents reference it. Turn create clones the env snapshot (when built) and applies resources, env vars, and networking.
- 5b7abb6: Use session detail API metrics for the agent session strip Turns/Duration/Cost instead of list-row hints or turn-by-turn aggregation. Include optional totalCostInUsd on TurnDoneMetrics so turn.done cost matches the wire contract.
- 8057109: Reattach a live turn via subscribe after create/subscribe SSE drops, using the last ingested sequence number so the composer stays running instead of toasting a network error.
- 2b76ce3: Update SandboxEnvironmentStatus from 'active' to 'ready' to align with backend environment version readiness, remove static default environment injection from draft selectors, fix sandbox provider readiness check latching false on EnvironmentsPage, and drain all sandbox environment pages with limit up to 1000 in agent draft pickers.

## 0.177.0-rc.4

### Patch Changes

- 8057109: Reattach a live turn via subscribe after create/subscribe SSE drops, using the last ingested sequence number so the composer stays running instead of toasting a network error.

## 0.177.0-rc.3

### Patch Changes

- fc99f4e: On refresh mid-turn, keep already-ingested running-tip model messages in live resume instead of hiding them behind the group baseline.

## 0.177.0-rc.2

### Patch Changes

- b9429a0: Preserve token and cost metrics on failed and cancelled turns in the UI adapter and types so turn headers and session totals include billable usage from non-done terminal turns.

## 0.177.0-rc.1

### Patch Changes

- d4bf49c: Clear `isRunning` and aborted stream controllers when a superseding send fails prior to starting `runStream`, and ensure `cancel()` clears `isRunning` after draining the in-flight run.
- d4bf49c: Keep the composer interactive during running and paused turns: Cancel only when empty, Send supersedes the prior client stream without cancelSession (preserving superseded in-flight turns in the transcript), and stacked pause chrome is abandoned after a later user message. Hosts that override ComposerSendButton and still branch only on isRunning should update to use hasContent.
- 2b76ce3: Add Environments page for sandbox environment CRUD (`/environments`), with UI Form and YAML editors, sidebar Envs nav, and a SandboxEnvironmentServer port.
- 5b7abb6: Avoid throwing agentSpec error when switching chats or rendering immutable sessions in Chat History.
- 5b7abb6: Prevent duplicate assistant message IDs when a turn stream finishes on mcp.auth_required without model messages.
- 6813758: On refresh mid-turn, baseline all prior root model messages for a new user tip so the previous turn's content does not leak into the resumed stream.
- 5b7abb6: Add sandbox-environment CRUD (tables, PUT upsert, subject ownership, soft-delete). Versions land as `pending` for a future controller. AgentSpec `config.sandbox.environment_name` names a caller-owned env; name `default` is reserved; delete returns 409 while agents reference it. Turn create clones the env snapshot (when built) and applies resources, env vars, and networking.
- 5b7abb6: Use session detail API metrics for the agent session strip Turns/Duration/Cost instead of list-row hints or turn-by-turn aggregation. Include optional totalCostInUsd on TurnDoneMetrics so turn.done cost matches the wire contract.
- 2b76ce3: Update SandboxEnvironmentStatus from 'active' to 'ready' to align with backend environment version readiness, remove static default environment injection from draft selectors, fix sandbox provider readiness check latching false on EnvironmentsPage, and drain all sandbox environment pages with limit up to 1000 in agent draft pickers.

## 0.2.0

### Minor Changes

- c6b78d9: Make sandbox provider port types identity-only; move Daytona lifecycle fields (`execTimeoutMs`, auto-stop/archive/delete intervals) onto host `DaytonaSandboxConfig`.
- a855122: Rename the published runtime package to `@truefoundry/trueforge-assistant-ui-runtime`, move it into the TrueForge workspace, rename its public runtime APIs to TrueForge, and remove the legacy TrueFoundry server adapter and server configuration.
- 829ac6e: Add OSS web-search provider settings and catalog (Parallel): singleton settings/catalog APIs, optional API key, and UI adapter without mode config so built-in web search works outside TrueFoundry mode.
- 829ac6e: Add web-search provider settings catalog port and Settings UI so admins can configure Parallel web search (API key + mode) in standalone/OIDC deployments.

### Patch Changes

- c783700: Show schedule tasks, agent context, and failed run reasons in the schedules table.
- f4ee3dc: Share sessions with tenant members (popover, `shared` PATCH, share routes), toast and redirect on forbidden/missing deep links, and stop the New Chat → named-history max-update-depth loop.
- fdd8520: Drive Agents and Schedules table pagination from API next/previous page tokens instead of row-count heuristics.

## 0.2.0-rc.0

### Minor Changes

- a855122: Rename the published runtime package to `@truefoundry/trueforge-assistant-ui-runtime`, move it into the TrueForge workspace, rename its public runtime APIs to TrueForge, and remove the legacy TrueFoundry server adapter and server configuration.
- 829ac6e: Add OSS web-search provider settings and catalog (Parallel): singleton settings/catalog APIs, optional API key, and UI adapter without mode config so built-in web search works outside TrueFoundry mode.
- 829ac6e: Add web-search provider settings catalog port and Settings UI so admins can configure Parallel web search (API key + mode) in standalone/OIDC deployments.
