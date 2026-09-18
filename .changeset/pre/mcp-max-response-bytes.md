---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Abort remote MCP HTTP response bodies over 50MB (`MCP_TOOL_CALL_MAX_RESPONSE_BYTES`) so oversized tool results cannot OOM the process.
