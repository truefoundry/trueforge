---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

`x-tfg-mcp-headers` entries with `Authorization` skip that MCP server's up-front consent flow (forwarded directly in open-source mode, sent as `x-tfy-mcp-headers` in TrueFoundry mode). Nested virtual MCP entries are accepted only in TrueFoundry mode, where they are sent as `x-tfy-mcp-headers`. If the MCP server rejects those caller headers with a 401, the turn pauses with `mcp.auth_required` when the server's consent flow returns an authorization URL; otherwise the 401 fails as an MCP error. Other requests keep their existing auth flow.
