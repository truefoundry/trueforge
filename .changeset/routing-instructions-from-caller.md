---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

The routing question no longer carries a default instruction. Each caller asks about its own input: a conversation asks about the latest user message, and a subagent task asks about that task.
