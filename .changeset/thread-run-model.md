---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-sdk': patch
---

Persist the model each subagent runs on, including the effort returned with it, so a rebuilt subagent resumes on both. A subagent on a different model from its parent runs on that model's own defaults instead of the parent's params. `AgentDefinition` no longer carries the model; it's a separate `AgentModel`.
