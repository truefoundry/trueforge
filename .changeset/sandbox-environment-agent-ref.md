---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Add sandbox-environment CRUD (tables, PUT upsert, subject ownership, soft-delete). Versions land as `pending` for a future controller. AgentSpec `config.sandbox.environment_name` names a caller-owned env; name `default` is reserved; delete returns 409 while agents reference it.
