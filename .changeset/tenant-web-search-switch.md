---
"@truefoundry/trueforge": patch
---

Add a tenant-wide web search switch stored in the new `tenant_setting` table. Capabilities and session or agent writes follow it, so new chats cannot turn web search on while it is off. Chats that already use web search keep it.
