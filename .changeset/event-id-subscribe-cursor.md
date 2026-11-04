---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-sdk': patch
---

Subscribe with from_event_id or after_event_id. New turn streams store and repair by event id and omit SSE sequence ids. after_sequence_number remains for older integer streams. The subscribe stream is not Fern-resumable, so the SDK does not reconnect it with Last-Event-ID. Regenerate SDK from the updated OpenAPI spec.
