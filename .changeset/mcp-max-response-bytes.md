---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Abort remote MCP HTTP response bodies over 50MB (`MCP_MAX_RESPONSE_BYTES`) so oversized tool results cannot OOM the process.
