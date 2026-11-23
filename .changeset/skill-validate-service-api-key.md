---
'@truefoundry/trueforge': patch
---

Named-agent session create validates skills with the service API key when `agent_id` is set; inline sessions and agent save still use the caller token.
