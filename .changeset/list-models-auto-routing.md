---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-sdk': patch
'@truefoundry/trueforge-ui': patch
---

`GET /api/v1/models` now reports `properties.auto_routing` for each model: whether the model supports Auto routing, then the categories it serves and whether it is in the Auto candidate list, or why it is unsupported. It also always returns `canonical_model`, `null` when unknown. The read shape is the new `ResolvedModelProperties`; `ModelProperties` is unchanged.
