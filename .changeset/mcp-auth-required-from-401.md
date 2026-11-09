---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Detect MCP outbound OAuth from gateway 401 `McpAuthRequiredError.authorization_urls` instead of proactive SFY authorize, and wrap `x-tfg-mcp-headers` as gateway `x-tfy-mcp-headers` (OSS merges them as HTTP headers).
