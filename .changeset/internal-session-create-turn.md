---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-sdk': patch
---

Add POST `/api/internal/sessions/{session_id}/turns` (service API key): non-streaming body, getSessionById, requires external_id + non-null source (skips memory ingest), SessionSource `integration` arm.
