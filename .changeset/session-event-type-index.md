---
"@truefoundry/trueforge": patch
---

Add a Postgres index on `session_event` by event type (`event->>'type'`), so queries that filter events by type no longer parse every event payload. The migration uses `IF NOT EXISTS`, so large deployments can pre-create the index `CONCURRENTLY` to avoid blocking event inserts during the build.
