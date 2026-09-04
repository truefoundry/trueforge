---
"@truefoundry/trueforge": patch
---

Accept `x-tfg-mcp` and `x-tfg-skills` in TrueFoundry mode: MCP servers and skills a request defines by name, taking precedence over the tenant registry for that request only. Both resolve for spec validation and turn execution; an unfiltered list still shows only configured resources, so request-scoped ones never appear in settings. Inline MCP credentials come from the manifest's own `auth.headers`, which lets a rotating token ride each turn.
