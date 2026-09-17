---
"@truefoundry/trueforge": patch
---

Allow renaming sessions via `PATCH /api/v1/sessions/{session_id}` with an optional `title` (trimmed, 1–50 chars).
