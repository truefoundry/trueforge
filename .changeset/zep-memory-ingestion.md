---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Add long-term memory ingestion behind `MEMORY_ENABLED` (off by default). A `memory-ingest` controller loop sends finished UI chats, and sessions on registry agents whose manifest enables memory, to Zep: user messages, `ask_user_question` answers and the final agent reply (context only). Progress is kept in a new `memory_ingest_cursor` table, and a partial `session_memory_ingest_idx` index serves the loop's scan. Export `ASK_USER_QUESTION_TOOL_NAME` from core.
