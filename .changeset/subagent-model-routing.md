---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Add optional subagent model routing. In TrueFoundry mode, `TRUEFOUNDRY_MODEL_ROUTING` turns it on per tenant: before a subagent starts, a decision model classifies its task, and the category picks the model it runs on. Off by default. Core adds `IDecisionModel`, a general decision-model interface on the OpenAI Decisions API types, with `OpenAIDecisionModel` as its implementation.
