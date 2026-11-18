---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Add subagent model routing, off by default and enabled per tenant with `TRUEFOUNDRY_MODEL_ROUTING` in TrueFoundry mode. A decision model classifies the subagent's task; the category and the parent's effort pick a list of models, and the subagent runs on the first one the caller has. Core adds `IDecisionModel` and `OpenAIDecisionModel`.
