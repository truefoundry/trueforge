---
'@truefoundry/trueforge': patch
---

A creator can no longer have two schedules on the same cron for one agent: creating or updating a schedule onto a cron you already use for that agent returns 409. The migration deletes existing duplicates, keeping the oldest schedule in each group.
