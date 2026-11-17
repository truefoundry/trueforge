---
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge': patch
---

Fix editing a message while a turn is open. Save & Rerun no longer sends twice, which threw "Composer is not available", and edit or retry no longer cancels and re-subscribes to the open turn before creating the branch. Tool approvals for directly loaded MCP tools now offer "Approve for 10 minutes" and "Approve in this session"; the runtime resolves the policy target for each pending approval and exposes it as `PendingApproval.policyTarget`. Use In Code stream samples iterate turn events directly: the TypeScript sample no longer unwraps `withMetadata`, and the Python sample opens the stream with a `with` block.
