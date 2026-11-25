---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Route an auto root thread to a new `frontier` cluster of the strongest models (Gemini 4 Carbon, Claude Fable 5.2, Claude Opus 5.5). Only the root's conversation is offered the `frontier` category; a subagent's task is classified among `direct`, `fixed_steps` and `adaptive` only, and `RouteInput` now takes the `categories` the classifier may choose from. Auto stays unavailable for a tenant until it has a model in every cluster, `frontier` included. `TRUEFOUNDRY_MODEL_ROUTING.categories` accepts an optional `frontier` meaning, so existing configs still parse. Linear: AGE-2942.
