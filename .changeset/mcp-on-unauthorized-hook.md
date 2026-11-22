---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

The MCP headers resolver's 401 hook is `onUnauthorized` and returns consent. Omitting the hook fails the 401. An `x-tfg-mcp-headers` entry whose `Authorization` is spelled in any casing still skips DCR.
