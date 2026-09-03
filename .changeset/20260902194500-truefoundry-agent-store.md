---
"@truefoundry/trueforge": patch
---

Sync ServiceFoundry remote agents on create/update/delete via TrueFoundryAgentStore and store the remote id in `external_id`. Filter `listAgents` by `external_ids`. Time out ServiceFoundry HTTP after 10s.
