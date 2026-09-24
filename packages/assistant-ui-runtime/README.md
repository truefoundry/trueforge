# @truefoundry/trueforge-assistant-ui-runtime

Headless React runtime that maps TrueForge sessions, turns, streaming events, tool approvals, and sub-agent threads onto assistant-ui's external-store runtime.

The package accepts a ready `AgentChatServer`. It does not construct backend clients, read credentials, or depend on a backend SDK.

## Installation

```bash
pnpm add @truefoundry/trueforge-assistant-ui-runtime @assistant-ui/react
```

React 18 and 19 are supported. `@assistant-ui/core` and `@assistant-ui/store` are installed with the runtime.

## Quick start

```tsx
'use client';

import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useTrueForgeAgentRuntime, type AgentChatServer } from '@truefoundry/trueforge-assistant-ui-runtime';

function Chat({ server }: { server: AgentChatServer }) {
  const runtime = useTrueForgeAgentRuntime({
    server,
    agent: { mode: 'named', agentName: 'support-agent' },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* Render assistant-ui Thread, Composer, and ThreadList primitives here. */}
    </AssistantRuntimeProvider>
  );
}
```

For the complete TrueForge UI, use `@truefoundry/trueforge-ui`. It supplies the built-in TrueForge HTTP adapter and re-exports the host-facing server contracts.

## Agent modes

Named agents use an existing server-side agent:

```ts
import type { TrueForgeAgentConfig } from '@truefoundry/trueforge-assistant-ui-runtime';

const agent = {
  mode: 'named',
  agentName: 'support-agent',
} satisfies TrueForgeAgentConfig;
```

Draft agents run from an inline spec and synchronize edits through the server:

```ts
import type { TrueForgeAgentConfig } from '@truefoundry/trueforge-assistant-ui-runtime';

const agent = {
  mode: 'draft',
  defaultAgentSpec: {
    model: { name: 'openai-main/gpt-4.1' },
    instructions: 'Answer concisely.',
  },
} satisfies TrueForgeAgentConfig;
```

`agentName` remains available as shorthand for named mode.

## Runtime options

`useTrueForgeAgentRuntime` accepts assistant-ui's external-store options plus:

| Option                          | Purpose                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `server`                        | Ready `AgentChatServer` implementation                      |
| `agent`                         | Named or draft agent configuration                          |
| `agentName`                     | Legacy named-agent shorthand                                |
| `initialSessionId`              | Initial session to load                                     |
| `threadId` / `onThreadIdChange` | Controlled active session                                   |
| `listSessionsAgentId`           | Optional history filter                                     |
| `listSessionsCreatedByMe`       | Restrict history to the authenticated subject               |
| `onError`                       | Load, turn, and stream error callback                       |
| `adapters`                      | Attachment, speech, dictation, voice, and feedback adapters |

## Runtime extras

The package exposes typed hooks for TrueForge-specific state and actions:

- `useTrueForgeApprovals`
- `useTrueForgeToolResponses`
- `useTrueForgeMcpAuth`
- `useTrueForgeRespondToToolApproval`
- `useTrueForgeRespondToToolResponse`
- `useTrueForgeContinueMcpAuth`
- `useTrueForgeDownloadSandboxFile`
- `useTrueForgeCancel`
- `useTrueForgeHistoryPagination`
- `useTrueForgeResetFromTurn`
- `useTrueForgeAgentSpec`
- `useTrueForgeUpdateAgentSpec`
- `useTrueForgeFlushAgentSpec`
- `useTrueForgeAdoptAgentSpec`

Use `trueForgeExtras`, `getTrueForgeExtras`, and `tryGetTrueForgeExtras` when integrating directly with assistant-ui state.

## Server contracts

Canonical server ports, DTOs, and stream events are exported from both the package root and the dedicated server entry:

```ts
import type {
  AgentChatServer,
  AgentUIServer,
  Session,
  Turn,
  TurnStreamingEvent,
} from '@truefoundry/trueforge-assistant-ui-runtime/server';
```

Important invariants:

- One server session maps to one assistant-ui thread.
- The root thread id is always `main`.
- Sub-agent threads nest below their creating tool call.
- One logical turn may span multiple SSE segments.
- A paused segment can close without completing its turn.
- Approval, tool-response, and MCP-auth continuation events are sent to the existing turn; the server automatically emits `turn.update: running` when all required actions are resolved.
- `subscribeToTurn` reconnects transport for the same turn and never resumes execution itself.
- Credentials remain host-owned.

### Paused turn lifecycle

`createTurn` is only for a real user-message turn. When execution requires human input, the server emits the requirement events followed by `turn.update` with `status: "paused"` and may close that SSE segment. The runtime keeps the same turn and assistant message active.

Each user action is submitted through `AgentChatServer.sendTurnEvents`. The runtime subscribes to the same turn with the last observed sequence number, folds the persisted user event, and waits for the server’s authoritative `turn.update: running`. Only `turn.done` commits the turn as terminal.

The host adapter and backend must expose the same paused-turn schema before enabling this flow, including `actionRequiredOnEvents` and `user.mcp_auth_continue`. The runtime deliberately has no continuation-turn compatibility fallback.

The server contract also accepts and preserves `user.tool_approval_policy` events. Applying session policy behavior and rendering “Always allow” controls remain host/UI concerns.

## Attachments

`trueForgeAttachmentAdapter` converts assistant-ui attachment input into TrueForge user-message content. Hosts can override it through the runtime `adapters` option.

## Package exports

- `@truefoundry/trueforge-assistant-ui-runtime`
- `@truefoundry/trueforge-assistant-ui-runtime/server`

## Development

Run from the trueforge repository root:

```bash
pnpm --filter @truefoundry/trueforge-assistant-ui-runtime build
pnpm test:assistant-ui-runtime
pnpm --filter @truefoundry/trueforge-assistant-ui-runtime typecheck
```

## License

MIT
