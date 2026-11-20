---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Add subagent model routing, off by default and enabled per tenant with `TRUEFOUNDRY_MODEL_ROUTING` in TrueFoundry mode. A classifier picks the task's cluster of model and effort pairs, and the subagent runs on the cheapest pair the caller has. Core adds the routing module (`createModelRouter`, which classifies with any `IDecisionModel`), `IDecisionModel` and `OpenAIDecisionModel`.
