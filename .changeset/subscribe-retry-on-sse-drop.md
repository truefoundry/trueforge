---
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Reattach a live turn via subscribe after create/subscribe SSE drops, using the last ingested sequence number so the composer stays running instead of toasting a network error.
