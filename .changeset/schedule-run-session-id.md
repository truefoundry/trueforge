---
'@truefoundry/trueforge': patch
---

Schedule runs now return `session_id`, the session each run created, so clients can open a run's
session. Existing runs are backfilled; runs without a session return `null`.
