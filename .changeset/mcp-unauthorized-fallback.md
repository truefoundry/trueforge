---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

`RemoteMCP` header resolvers can return `onUnauthorized`, used once on a 401. An MCP server rejecting an `x-tfg-mcp-headers` `Authorization` now falls back to its regular authorization flow.
