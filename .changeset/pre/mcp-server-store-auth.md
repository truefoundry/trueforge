---
"@truefoundry/trueforge": patch
---

Split MCP server persistence (`IMcpServerStore`) from Connect UX auth (`IMcpServerWithAuthStore` / `McpServerWithAuthStore`) so DB backends stay CRUD + OAuth client columns while authorize/status/revoke compose in via a token store.
