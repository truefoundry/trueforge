---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Route an auto root thread to a new `frontier` model cluster. Subagents are never offered it, and `RouteInput` now takes the `categories` the classifier may choose from. GPT-6.1 Sol and Sonnet 5.5 at `max` move from `adaptive` to `frontier`. The `fixed_steps` and `adaptive` descriptions are sharpened. `TRUEFOUNDRY_MODEL_ROUTING.categories` takes an optional `frontier`.
