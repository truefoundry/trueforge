---
'@truefoundry/trueforge': patch
---

Enforce one schedule per agent, cron expression, and creator. Existing duplicates are removed by migration (oldest kept); conflicting creates/updates return 409.
