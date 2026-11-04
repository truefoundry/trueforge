---
'@truefoundry/trueforge': patch
---

Reject a second schedule with the same cron for the same agent and creator (409). The migration keeps the oldest of any existing duplicates and deletes the rest.
