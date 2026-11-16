---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

`x-tfg-mcp-headers` entries with `Authorization` skip that MCP server's consent flow (forwarded directly in open-source mode, sent as `x-tfy-mcp-headers` in TrueFoundry mode). Nested virtual MCP entries are accepted only in TrueFoundry mode, where they are sent as `x-tfy-mcp-headers`. TrueFoundry mode no longer calls MCP authorize during turns. A 401 with `authorization_urls` pauses the turn with `mcp.auth_required`; any other 401 fails as an MCP error.
