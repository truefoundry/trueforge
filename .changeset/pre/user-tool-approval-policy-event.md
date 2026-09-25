---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Add `user.tool_approval_policy` send-event schema (`allow_session`, optional ISO `expire_at`). Send-only like `user.tool_approval` / `user.tool_response` — not on the durable stream.
