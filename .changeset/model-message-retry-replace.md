---
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Replace an unfinished `model.message` (no `finishReason`) when a new event id arrives so BE model-call retries clear partial deltas instead of concatenating them.
