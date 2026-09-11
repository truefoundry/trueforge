---
"@truefoundry/trueforge-core": patch
---

Persist model.message reasoning_content on session events by deriving it from thinking_blocks so reasoning survives reload without storing it on thread context.
