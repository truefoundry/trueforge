---
'@truefoundry/trueforge': patch
---

`x-tfg-mcp-headers` entries with `Authorization` skip that MCP server's up-front consent flow (forwarded directly in open-source mode, sent as `x-tfy-mcp-headers` in TrueFoundry mode). Nested virtual MCP entries are accepted only in TrueFoundry mode, where they are sent as `x-tfy-mcp-headers`. A 401 on those calls fails as an MCP error. Other requests keep their existing auth flow.
