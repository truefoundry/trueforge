# @truefoundry/trueforge-assistant-ui-runtime

## 0.9992.1

### Patch Changes

- b58c47e: Avoid throwing agentSpec error when switching chats or rendering immutable sessions in Chat History.
- 04c3aa7: Prevent duplicate assistant message IDs when a turn stream finishes on mcp.auth_required without model messages.
- 1bf436e: Add sandbox-environment CRUD (tables, PUT upsert, subject ownership, soft-delete). Versions land as `pending` for a future controller. AgentSpec `config.sandbox.environment_name` names a caller-owned env; name `default` is reserved; delete returns 409 while agents reference it. Turn create clones the env snapshot (when built) and applies resources, env vars, and networking.
- c0cd17b: Use session detail API metrics for the agent session strip Turns/Duration/Cost instead of list-row hints or turn-by-turn aggregation. Include optional totalCostInUsd on TurnDoneMetrics so turn.done cost matches the wire contract.

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
