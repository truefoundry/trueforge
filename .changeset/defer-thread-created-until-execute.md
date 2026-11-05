---
'@truefoundry/trueforge-core': patch
---

Emit `thread.created` when a subagent thread starts executing, not when it is only queued behind the parallel subagent limit. Store registration happens earlier via an internal queued event so cancel can still persist against the child row.
