---
'@truefoundry/trueforge': minor
---

Add `GET /settings/model-providers/{name}/discovered-models`, which asks a configured provider which models it serves. Gemini's native list reports token limits, so discovered models carry the `context_length` that context compaction relies on; other providers use the OpenAI-compatible list, which reports ids only.
