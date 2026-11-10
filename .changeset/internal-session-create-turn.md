---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Add POST `/api/internal/sessions/{session_id}/turns` (service API key): InternalCreateSessionTurnRequest (stream default false), tenant via getSessionById, requires session.external_id, no memory.
