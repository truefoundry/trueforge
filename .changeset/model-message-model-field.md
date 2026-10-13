---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Add optional AgentSpec-shaped `model` (`{ name: provider/model, params? }`) on `model.message` events, stamp it from the bound agent definition for new turns, and backfill the session tip turn's events / turn output from the session agent model FQN.
