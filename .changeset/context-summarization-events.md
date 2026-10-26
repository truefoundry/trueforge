---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Emit `agent.context.summarization.start` / `.end` events around context compaction so clients can show progress while summarization runs.
