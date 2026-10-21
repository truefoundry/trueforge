---
'@truefoundry/trueforge': patch
---

Unify admin checks with `hasAdminRole` (tenant-admin in TrueFoundry) and gate sandbox environment create to admins while allowing the creator or an admin to update or delete. Schedule mutate and run-now stay creator-or-admin; settings access remains disabled in TrueFoundry via `canAccessSettings`.
