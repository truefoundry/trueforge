---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

`x-tfg-mcp-headers` passes per-MCP-server headers. Open-source mode merges a server's entry over its registered headers, and an entry `Authorization` skips DCR. TrueFoundry mode sends the entry (flat, or a nested virtual MCP map) as `x-tfy-mcp-headers` and no longer calls authorize before connecting. On a 401: a call with caller credentials fails; otherwise a DCR server (open-source) restarts consent, and TrueFoundry asks authorize for a consent URL, failing with 422 when there is none.
