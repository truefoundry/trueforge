---
'@truefoundry/trueforge-core': patch
---

Report cache write tokens for gateway models. The OpenAI-compatible adapter drops the cache write count, so sessions showed cache reads with no writes; the count is now recovered from the raw usage payload.
