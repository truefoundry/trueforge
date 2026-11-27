---
'@truefoundry/trueforge-core': patch
---

Close remote MCP connections when a turn ends, so an SSE session does not stay open until its GET times out.
