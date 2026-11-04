---
'@truefoundry/trueforge': patch
---

Reject a second schedule with the same cron for the same agent and creator (409). Existing duplicates are removed on migration, keeping the oldest.
