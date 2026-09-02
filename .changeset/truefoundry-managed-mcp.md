---
"@truefoundry/trueforge": patch
---

Add a TrueFoundry-managed MCP registry. When `TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` is set, MCP servers are listed from ServiceFoundry with resolved AI Gateway proxy URLs, and turns/tools call the gateway with the caller's Bearer token. Create/update return 424; OAuth authorize/status are stubbed as authenticated for v1.
