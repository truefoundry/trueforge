---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Allow a user message to start a turn while approvals, client-side tools, or sub-agent threads are pending: close unmatched last-assistant tool calls in context and omit dropped child threads from the successor turn snapshot.
