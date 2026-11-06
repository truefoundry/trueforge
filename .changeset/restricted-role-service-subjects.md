---
'@truefoundry/trueforge': patch
---

OIDC: add `OIDC_RESTRICTED_ROLE_VALUE` / `OIDC_RESTRICTED_AGENT_NAMES` to confine a role to a fixed set of saved agents (no agent or schedule creation, no unsaved-agent sessions), and `OIDC_SERVICE_SUBJECTS` to let machine tokens without an `email` claim bypass `OIDC_ALLOWED_EMAILS`.
