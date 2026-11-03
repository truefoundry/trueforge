---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Add long-term memory to chat sessions.

- On a session's first turn, the user's memory summary is added once as a hidden message, capped at about 1,000 tokens.
- UI chats and sessions on agents with `config.memory.enabled` get `memory_search` and `memory_add` tools on the main agent only; `memory_add` runs only when the user asks to remember something.
- Memory works in TrueFoundry mode only, behind the `TRUEFOUNDRY_MEMORY_*` settings and the tenant allowlist.
- Saving an agent or inline spec that turns memory on while it is unavailable for the deployment or tenant returns 422.
