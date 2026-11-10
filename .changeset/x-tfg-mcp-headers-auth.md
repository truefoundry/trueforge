---
'@truefoundry/trueforge': patch
---

`x-tfg-mcp-headers` entries with `Authorization` skip that MCP server's consent flow: forwarded directly in open-source mode (along with other per-server headers), sent as `x-tfy-mcp-headers` in TrueFoundry mode.
