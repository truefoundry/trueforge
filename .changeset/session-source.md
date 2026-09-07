---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge-sdk": patch
---

Add optional session `source`. Persist as nullable JSONB with a list filter index; expose on session responses and list via `source_type` / `source_id`. Schedule dispatch sets source on create; public create/update do not accept it.
