---
"@truefoundry/trueforge": patch
---

Add a partial Postgres index on `session_event (session_id)` for `sandbox.created`, `model.message`, and `thread.created` events, so per-session feature-adoption analytics no longer parse every event payload. The migration uses `IF NOT EXISTS`, so large deployments can pre-create the index `CONCURRENTLY` to avoid blocking event inserts during the build.
