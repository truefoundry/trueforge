---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Cap tool calls per assistant step (default 20); over-limit fails the turn. Bounds memory alongside the 50MB MCP body limit.
