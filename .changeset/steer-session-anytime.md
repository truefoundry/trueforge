---
"@truefoundry/trueforge-core": patch
---

Allow a user message to start a turn while approvals, client-side tools, or sub-agent threads are pending: close those calls synthetically and cancel open sub-agents with `thread.done` status `cancelled`.
