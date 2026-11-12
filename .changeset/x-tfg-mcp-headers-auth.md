---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

`x-tfg-mcp-headers` entries with `Authorization` skip that MCP server's consent flow: forwarded directly in open-source mode (along with other per-server headers), sent as `x-tfy-mcp-headers` in TrueFoundry mode. A rejected credential falls back to the server's regular auth via a new `RemoteMCP` `onUnauthorized` hook. TrueFoundry mode no longer calls the MCP authorize endpoint during turns: a 401 whose body includes `authorization_urls` pauses the turn with `mcp.auth_required`, and a bare 401 still fails as an MCP error. A virtual MCP's entry may nest one header map per underlying server; in TrueFoundry mode it is passed through as `x-tfy-mcp-headers`.
