---
'@truefoundry/trueforge-core': patch
---

Emit `thread.created` when a subagent thread starts executing, not when it is only queued behind the parallel subagent limit. Cancel of a never-started child no longer requires a store row.
