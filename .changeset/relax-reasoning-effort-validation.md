---
"@truefoundry/trueforge": patch
---

Only validate `model.params.reasoning_effort` against a model's advertised efforts when that list is non-empty, so models without configured efforts no longer reject specs that set it.
