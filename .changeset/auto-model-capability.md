---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-sdk': patch
---

`GET /api/v1/capabilities` reports `auto.enabled`: model routing is on for the tenant and the user has a model in every routing cluster. The new-chat model picker offers Auto, which is only selectable when that capability is enabled. Core adds `canRouteEveryCategory`.
