---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-sdk": patch
---

List sessions accepts `metadata[key]=value` query params (OpenAPI deepObject) for exact metadata containment filtering. Bare JSON-string `metadata` query params are rejected. Metadata keys are limited to 32 characters and cannot include `[]` or whitespace so they do not collide with the bracket query form.
