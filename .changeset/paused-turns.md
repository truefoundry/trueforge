---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-sdk': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Turns now pause, instead of finishing, while waiting for user input such as tool approvals, questions, or MCP authentication. The same turn resumes once every required interaction is answered. Clients send those answers as events on the paused turn and can reconnect to its event stream at any point.

- While a turn is paused, its cost and time so far stay visible. Time spent waiting on the user does not count. Cancelling a paused turn still shows its final cost and time.
- Conversations that were already waiting on the user stay waiting after upgrade, with the same cost, time, and status.
- The chat shows a waiting notice instead of a running indicator while a turn is paused or cannot continue.
- A conversation is saved to memory only after it finishes, not while it is waiting on the user.
- Creating a turn rejects an empty user message.

Breaking changes for package consumers:

- `@truefoundry/trueforge-assistant-ui-runtime`: `useTrueForgeResumeMcpAuth` is renamed to `useTrueForgeContinueMcpAuth`, and `findCurrentPausedAssistantMessage` to `findPausedAssistantMessage`. `collectRequiredActionInputs`, `collectApprovalInputs`, `toTrueForgeApprovalInputs`, `collectResponseInputs`, and `TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY` are removed; answer approvals and questions with `useTrueForgeRespondToToolApproval` and `useTrueForgeRespondToToolResponse` instead.
- Custom chat servers must implement `sendTurnEvents` to deliver answers to a paused turn.
- `@truefoundry/trueforge-ui`: `ToolApprovalContainer` takes `approvalId` and `onRespond` instead of `options` and `onSelectOption`.
