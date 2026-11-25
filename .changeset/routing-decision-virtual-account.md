---
'@truefoundry/trueforge': patch
---

Model routing loads one shared decision model at startup from `decision_model.name` and `decision_model.api_key` in `TRUEFOUNDRY_MODEL_ROUTING`, and every tenant classifies with it.
`decision_model` is top-level there; turn off gateway logging for its virtual account.
