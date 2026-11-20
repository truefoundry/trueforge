---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-sdk': patch
---

Add a tenant switch for Auto mode, on by default, on the Models settings page. Admins reach the page in TrueFoundry mode when model routing is set up for the tenant; provider editing stays with the platform there. Turning it off turns off all model routing for the tenant: Auto leaves the model picker, `auto` specs are rejected, chats that already use Auto fail their next turn with "Auto mode is turned off for this tenant", and subagents run on their parent's model. `GET /api/v1/capabilities` leaves `auto` out when routing isn't set up for the tenant and gives a `reason` when it is unavailable. The configuration manifest adds `auto: { enabled }`.
