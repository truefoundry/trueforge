---
"@truefoundry/trueforge-core": patch
---

Raise remote MCP undici bodyTimeout to 30m so idle SSE streams are not killed at 5m; warn on Body Timeout and stringify other transport errors.
