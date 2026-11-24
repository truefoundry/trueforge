---
'@truefoundry/trueforge': patch
---

Model routing calls one shared decision model for every tenant, through a virtual account set with `TRUEFOUNDRY_MODEL_ROUTING_API_KEY`. `TRUEFOUNDRY_MODEL_ROUTING` moves `decision_model` out of the tenant entries into a top-level `decision_model: { tenant_id, name }`. The virtual account's tenant needs a gateway logging config with `log: false` for that account, since decision requests carry other tenants' messages.
