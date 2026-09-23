---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Add `POST /sessions/{session_id}/turns/{turn_id}/events` to persist inbound tip HITL / policy events. Response items use the same `UserToolApprovalEvent` / `UserToolResponseEvent` / `UserToolApprovalPolicyEvent` shapes as `SessionEvent` and the turn SSE stream.
