---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-ui": patch
---

Make the list turns, list session events, and list turn events page size configurable.

- `LIST_EVENTS_PAGE_LIMIT_MAX` (default 100) sets the default and max `limit` for `GET /sessions/{session_id}/events` and `GET /sessions/{session_id}/turns/{turn_id}/events`.
- `LIST_TURNS_PAGE_LIMIT_MAX` (default 25) sets the default and max `limit` for `GET /sessions/{session_id}/turns`.
- Larger values return 400.
- The `listTurns`, `listEvents`, `listTurnEvents`, and `listSessionEvents` server ports no longer take `limit`; the server setting controls the page size.
