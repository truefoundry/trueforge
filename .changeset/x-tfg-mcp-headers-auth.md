---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

`x-tfg-mcp-headers` passes per-MCP-server headers. Open-source mode merges a server's entry over its registered headers, and an entry `Authorization` skips DCR. TrueFoundry mode sends the entry (flat, or a nested virtual MCP map) as `x-tfy-mcp-headers` and no longer calls authorize before connecting. On a 401: open-source fails when the entry carried `Authorization`, otherwise a DCR server restarts consent; TrueFoundry fails whenever the server had an entry, otherwise asks authorize for a consent URL and fails with 422 when authorize returns none or reports no consent is needed.
