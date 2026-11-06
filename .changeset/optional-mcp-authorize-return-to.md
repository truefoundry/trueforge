---
'@truefoundry/trueforge': patch
---

`GET /api/v1/mcp-servers/{name}/authorize` no longer sends a `redirectURL` to the TrueFoundry MCP gateway when `return_to` is omitted, so the gateway shows its own post-authentication page instead of redirecting to the TrueForge home. An empty `return_to` is now rejected with 400.
