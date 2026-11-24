---
'@truefoundry/trueforge': patch
---

Model routing uses one shared decision model for all tenants, called with `decision_model.api_key` in `TRUEFOUNDRY_MODEL_ROUTING`.
`decision_model` is top-level there; turn off gateway logging for its virtual account.
