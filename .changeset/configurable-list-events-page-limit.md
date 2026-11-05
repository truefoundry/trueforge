---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-ui": patch
---

Make the list session events, list turn events, and list turns page size configurable.

- `LIST_EVENTS_PAGE_LIMIT_MAX` (default 100) sets both the default and the maximum `limit` for `GET /sessions/{session_id}/events` and `GET /sessions/{session_id}/turns/{turn_id}/events`. Larger values return 400.
- `LIST_TURNS_PAGE_LIMIT_MAX` (default 25) sets both the default and the maximum `limit` for `GET /sessions/{session_id}/turns`. Larger values return 400.
- The chat runtime and Agent Details session view no longer send a hardcoded `limit` for these calls, so the server setting controls the page size.
