---
'@truefoundry/trueforge': patch
---

Clear DCR OAuth tokens and pending authorizations when an MCP server URL changes, since the URL is the token audience.
