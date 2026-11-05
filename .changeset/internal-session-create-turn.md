---
'@truefoundry/trueforge': patch
---

Add POST `/api/internal/sessions/{session_id}/turns` (service API key): same create-turn path and body as `/api/v1/sessions/{session_id}/turns`, plus `tenant_id`; non-streaming only.
