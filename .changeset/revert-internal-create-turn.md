---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-sdk': patch
---

Revert the internal `POST /api/internal/sessions/{session_id}/turns` endpoint and the `service` session source arm. Keep `getSessionById` for service-key assume-user turn flows.
