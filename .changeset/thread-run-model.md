---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Persist the model each thread runs on, so a rebuilt subagent resumes on it. A subagent on a different model from its parent runs on that model's own defaults instead of the parent's params. `AgentDefinition` no longer carries the model; it's a separate `AgentModel`.
