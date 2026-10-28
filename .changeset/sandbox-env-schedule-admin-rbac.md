---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-sdk': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Unify admin checks with `hasAdminRole` (tenant-admin in TrueFoundry) and gate sandbox environment create to admins while allowing the creator or an admin to update or delete. Expose schedule and sandbox environment `MANAGE`/`DELETE` (and tenant `sandbox_environment` `CREATE`) via list-permissions so the UI matches the API; settings access remains disabled in TrueFoundry via `canAccessSettings`.
