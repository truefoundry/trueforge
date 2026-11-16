---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

`x-tfg-mcp-headers` entries with `Authorization` skip that MCP server's consent flow (forwarded directly in open-source mode, sent as `x-tfy-mcp-headers` in TrueFoundry mode), falling back to the server's regular auth on a 401. Nested virtual MCP entries are accepted only in TrueFoundry mode, where they are sent as `x-tfy-mcp-headers`. TrueFoundry mode no longer calls MCP authorize during turns: a 401 with `authorization_urls` pauses the turn with `mcp.auth_required`, and a bare 401 fails as an MCP error.
