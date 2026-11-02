---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-ui": patch
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-sdk": patch
---

Add a tenant-wide web search switch stored in the new `configuration` table, with `GET` and `PATCH /api/v1/settings/configurations` behind an admin gate. Capabilities and session or agent writes follow it, so new chats cannot turn web search on while it is off; chats that already use web search keep it. Each schedule records the switch as it stood when the schedule was created, so its runs keep searching the web even after an admin turns the switch off. The `settings` capability now reports one entry per settings section with its own `enabled` and `manage_providers`.
