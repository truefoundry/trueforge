---
"@truefoundry/trueforge": patch
---

Add internal POST /api/internal/import/agents and POST /sessions (snapshot) plus GET /checkpoint?tenant_id= for SF→TrueForge backfill. Import requires the service API key. Named session import links a local agent when present; otherwise uses a dummy agent_id (SF /full omits agentId). Checkpoint is per-tenant min created_at of imported sessions. Misconfig and unexpected failures return 500 with error details.
