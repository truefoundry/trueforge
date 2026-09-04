---
"@truefoundry/trueforge": patch
---

Add NOT NULL `agent_id` on `schedule` (backfilled from `agent`), FK to `agent(id)`, and `(tenant_id, agent_id)` index for per-agent listing.
