---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Add POST `/api/internal/list-permissions` via `Authorizer.getPermissions` (owner grants for schedules/sessions; agents include `USE`, with TrueFoundry agents mapped from SFY `USE_AGENT`/`MANAGE_AGENT`/`DELETE_AGENT`).
