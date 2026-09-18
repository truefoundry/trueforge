---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Add `POST /sessions/{session_id}/events` to persist inbound tip HITL / policy events into `session_inbound_events` (no apply/wake yet). Response returns persisted events with minted `id` and `created_at`.
