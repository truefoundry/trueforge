---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Cancel now ends paused turns as well as running ones: a paused turn that is live on its executor is aborted, and otherwise it is frozen as `cancelled` so the session is not left waiting on approvals.
