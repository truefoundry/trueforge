---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-sdk': patch
---

Add a tenant switch for auto model routing, on by default, on the Models settings page. Turning it off turns off model routing for the tenant: `auto` specs are rejected and subagents run on their parent's model. `GET /api/v1/capabilities` now returns `auto: { status, reason? }` where `status` is `not_configured`, `disabled`, or `enabled`, replacing `auto.enabled`. The configuration manifest adds `auto_model_routing: { enabled }`.
