---
'@truefoundry/trueforge': patch
---

Model routing uses one shared decision model for all tenants, called via `TRUEFOUNDRY_MODEL_ROUTING_API_KEY`.
`decision_model` is now top-level in `TRUEFOUNDRY_MODEL_ROUTING`; turn off gateway logging for its virtual account.
