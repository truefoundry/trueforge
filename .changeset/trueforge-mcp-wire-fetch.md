---
'@truefoundry/trueforge': patch
---

TrueForge MCP internal API tool calls use the process mTLS fetch and the caller's credential directly, instead of the Fern SDK passthrough client.
