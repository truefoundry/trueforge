---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Require AgentSpec-shaped `model` (`{ name: provider/model, params? }`) on every `model.message` event, stamp it from the bound agent definition, and backfill existing session events / turn outputs from the session agent model FQN.
