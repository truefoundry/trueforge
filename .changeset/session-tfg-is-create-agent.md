---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
---

New Agent chats are stamped `tfg.is_create_agent`, and existing sessions are rewritten so they still reopen as the agent builder and stay out of memory.
