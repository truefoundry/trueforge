---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-sdk': patch
---

`GET /api/v1/models` now reports `properties.auto_routing` for each model: whether Auto can route to it, the categories it serves and whether it is in the global Auto list, or why it is unsupported. It also returns `canonical_model` when known.
