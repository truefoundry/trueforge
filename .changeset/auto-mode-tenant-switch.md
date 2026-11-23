---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-sdk': patch
---

Add a tenant switch for Auto mode, on by default, on the Models settings page. Turning it off turns off model routing for the tenant: `auto` specs are rejected and subagents run on their parent's model. `GET /api/v1/capabilities` omits `auto` when routing isn't set up and gives a `reason` when Auto is unavailable. The configuration manifest adds `auto: { enabled }`.
