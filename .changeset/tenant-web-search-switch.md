---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-ui": patch
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-sdk": patch
---

Add a tenant-wide web search switch stored in the new `configuration` table, with `GET` and `PATCH /api/v1/settings/configuration` behind an admin gate. Capabilities and session or agent writes follow it, so web search cannot be turned on while the switch is off; a spec that already has it on keeps it, which also leaves existing agents and their schedules running. The `settings` capability now reports one entry per settings section with its own `enabled` and `manage_providers`. Catalog settings routes that the deployment does not own answer 422 naming the route, where they previously answered 403.
