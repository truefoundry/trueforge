---
"@truefoundry/trueforge": minor
---

Add `DELETE /api/v1/settings/mcp-servers/{name}` to permanently remove a configured MCP server (its OAuth tokens and pending authorizations cascade-delete). Idempotent if already gone.
