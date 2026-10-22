---
"@truefoundry/trueforge": patch
---

Add a `warning` field to models returned by `GET /api/v1/models` when reasoning effort or context length is missing. The OSS stores note the output might not be efficient; the TrueFoundry store also directs users to edit the model in the TrueFoundry models section.
