---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Add optional subagent model routing. In TrueFoundry mode, `TRUEFOUNDRY_MODEL_ROUTING` turns it on per tenant: before a subagent starts, a decision model rates each of the caller's scored models for the task, and the highest-rated one is picked. `shadow` logs the pick and keeps the parent's model; `on` runs the pick. Off by default.
