---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Add POST `/api/internal/sessions/{session_id}/turns` (service API key): same create-turn body as `/api/v1`, with tenant resolved via `getSessionById` (session_id only, like schedule `getRunById`); non-streaming only.
