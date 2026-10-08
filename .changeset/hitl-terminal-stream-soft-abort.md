---
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Yield terminal `turn.done` error state instead of throwing, and return early from already-aborted turn streams so subscribe-retry treats only transport drops as reconnectable.
