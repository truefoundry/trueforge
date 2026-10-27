---
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Default reasoning effort now follows `medium` → `high` → `low` in both the draft (New Chat) composer and the agent builder (Agent Config) when the selected model does not offer `medium`, instead of falling back to the lowest offered effort.
