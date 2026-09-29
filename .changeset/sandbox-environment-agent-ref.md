---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Add real sandbox-environment CRUD (versioning, soft-delete). Environments are subject-owned. AgentSpec `config.sandbox.environment_name` names a configured environment owned by the caller; delete returns 409 while agents reference it. Name `default` is reserved.
