---
"@truefoundry/trueforge": patch
---

Sync ServiceFoundry remote agents on create/update/delete and store the remote id in `external_id`. Filter `listAgents` by `external_ids`. Keep general ServiceFoundry HTTP at 10s and agent CRUD calls at 3s.
