---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

A subagent on a different model from its parent no longer inherits the parent's model params: it runs on that model's own defaults (its known `max_tokens`, or none) with parallel tool calls on. `thread.created` records the model the subagent actually runs on, every thread's checkpoint records the model it ran on in each turn, and a rebuilt subagent comes back on that model; the root still follows its spec.
