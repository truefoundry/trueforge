---
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

The first time Auto model routing is enabled for a tenant, New Chat switches the draft model preference to Auto once. A stored marker keeps later model choices from being overwritten. The model picker shows a hover tooltip explaining Auto routing. Draft spec updates made back to back before a re-render now build on each other instead of the last one winning.
