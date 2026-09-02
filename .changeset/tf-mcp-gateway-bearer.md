---
"@truefoundry/trueforge": patch
---

TrueFoundry MCP invoke headers are owned by the MCP store (`resolveInvokeHeaders`), so gateway Bearer comes from the request-scoped store rather than being threaded through turn/tools APIs.
