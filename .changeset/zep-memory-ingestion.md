---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Add long-term memory ingestion behind `TRUEFOUNDRY_MEMORY_ENABLED` (TrueFoundry mode only, off by default), configured like the shared sandbox with `TRUEFOUNDRY_MEMORY_PROVIDER` (`zep`), `TRUEFOUNDRY_MEMORY_API_KEY` and an optional `TRUEFOUNDRY_MEMORY_SERVER_URL`, for the tenants listed in `TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST` only. A `memory-ingest` controller loop sends finished UI chats, and sessions on registry agents whose manifest enables memory, to Zep: user messages, `ask_user_question` answers and the final agent reply (context only). Progress is kept in a new `memory_ingest_cursor` table. Export `ASK_USER_QUESTION_TOOL_NAME` from core.
