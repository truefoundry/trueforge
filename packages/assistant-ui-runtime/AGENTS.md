- One server session maps to one assistant-ui thread (`session.id` is the thread `remoteId`).
- The root thread id is always `main`; sub-agent threads nest beneath their creating tool call.
- The runtime accepts a ready `AgentUIServer` and MUST NOT own credentials or construct backend clients.
- Pause is in-stream: a `turn.update` paused event MUST NOT complete the stream consumer. Keep draining until `turn.done`.
- Required-action responses MUST be sent to the existing turn through `sendTurnEvents`; only the server may transition it back to running.
- The inbound event union MUST stay aligned with backend approval, response, approval-policy, and MCP-auth-continue events.
- `subscribeToTurn` is transport reconnection, never an execution-resume command.
- Named and draft agent modes share the same runtime; draft spec updates remain synchronized through the server port.
- Canonical server ports, DTOs, and events live in `src/server/types.ts` and `src/server/events.ts`.
- Wire event/status constants live beside those canonical contracts; runtime code MUST reuse them instead of repeating protocol strings.
- Public runtime names use `TrueForge`, never the removed `TrueFoundry` backend name.

## Code comments

- Comments MUST be scenario-based: state the situation that triggers the code and why it is handled this way, e.g. "This happens when …, we do this because …" or "When …, we … so that …".
- A comment MUST NOT only restate what the code does (e.g. "Maps toolCallId to model.message id"); name the case it covers instead.
- Comments stay brief (one to three lines) and follow the root `AGENTS.md` comment rules.
