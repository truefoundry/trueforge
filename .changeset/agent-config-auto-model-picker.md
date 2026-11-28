---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

The agent config model picker can switch an agent to Auto and choose its candidate models. Auto sits above the provider list, and a warning label on the candidates explains when saved models are no longer in the workspace list, with Review changes and Sync with workspace actions on hover.
Model picker rows now carry `properties.autoRouting`.
