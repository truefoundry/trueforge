---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-sdk': patch
---

Let an admin choose which models auto routing may pick from, on the Models settings page. The configuration manifest's `auto_model_routing` adds `candidate_models`: 4 to 10 full model names (`account/model`), or empty. It is empty by default, and an empty list allows no model, so Auto stays unavailable until an admin chooses some. Lists of 1 to 3 models are rejected. Routing and the `auto` capability use the models a user has access to, narrowed to that list. `PATCH /api/v1/settings/configuration` now merges into `auto_model_routing`, so changing `enabled` keeps the list.
