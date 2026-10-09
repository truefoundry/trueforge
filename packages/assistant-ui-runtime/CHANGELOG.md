# @truefoundry/trueforge-assistant-ui-runtime

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
