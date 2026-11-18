---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Split the model out of `AgentDefinition`: a thread now takes its `definition` (instructions, messages, tools, response format, iteration limit) and a separate `model` (`AgentModel`: client, name, provider type, properties and params). `resolveAgentDefinition` returns both. No behaviour change.
