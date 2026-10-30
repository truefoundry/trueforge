---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Give eligible sessions long-term memory from Zep: UI chats use the default memory scope, and sessions on agents with `config.memory.enabled` use that agent's scope. The user's memory summary is loaded once, on the session's first turn, and kept in the system prompt; the main agent (not sub-agents) gets `memory_search` and `memory_add` tools bound to the session's user, with `memory_add` used only when the user asks to remember something. Saving an agent or inline spec with `config.memory.enabled` returns 422 when memory is off for the deployment or tenant. Ingestion now reads `config.memory.enabled`. Core adds the `memory` capability, passes `tracing` to `rootCapabilities`, and exports `NOOP_AGENT_TRACING`.
