---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

TrueFoundry mode no longer calls the MCP authorize endpoint during turns. A 401 from an MCP server whose body includes `authorization_urls` now pauses the turn with `mcp.auth_required` and that consent URL; a bare 401 still fails as an MCP error.
