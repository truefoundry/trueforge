---
"@truefoundry/trueforge": patch
---

Add internal POST /api/internal/import/agents and POST /sessions (snapshot) plus GET /checkpoint?tenant_id= for SF→TrueForge backfill. Import requires the service API key. Named session import links a local agent when present (or SF agent_id / dummy). Drafts use agent_spec; when SF also sends name/id those go in metadata. Checkpoint is per-tenant min created_at of imported sessions.
