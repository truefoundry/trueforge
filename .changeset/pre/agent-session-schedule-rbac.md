---
'@truefoundry/trueforge-core': minor
'@truefoundry/trueforge': minor
---

Agent access is decided only by the `Authorizer`: standalone/OIDC lets everyone list and use agents and restricts update/delete to the creator; TrueFoundry uses external permissions api.

You can read a session, turn, events, metrics, schedule, or its runs if you created it, or if you manage the named agent it is bound to. Creating still requires permission to use that agent. Only the creator can update, delete, or cancel a session, create a turn, or download sandbox files. Only the creator can update, delete, pause, resume, or run a schedule. An OIDC settings admin can no longer see other users' schedules.
