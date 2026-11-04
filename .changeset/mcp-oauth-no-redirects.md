---
'@truefoundry/trueforge': patch
---

Refuse HTTP redirects on MCP OAuth discovery, DCR, token exchange, and refresh so authorization-server credentials are never replayed to a Location host.
