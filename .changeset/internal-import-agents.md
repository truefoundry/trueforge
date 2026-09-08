---
"@truefoundry/trueforge": patch
---

Add internal POST /api/internal/import/agents and POST /sessions (snapshot) plus GET /checkpoint for SF→TrueForge backfill. Session import keeps agent_name when the local agent is missing (agent_id null). Misconfig and unexpected session/checkpoint failures return 500 with error details.
