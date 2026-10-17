---
'@truefoundry/trueforge': patch
---

In TrueFoundry mode, `x-tfg-skills`, `x-tfg-mcp`, and `x-tfg-models` are allowed when creating an inline session, replacing its spec, or running a turn on it. Create and replace only use the headers to check the spec and do not save them. `x-tfg-skills` must list every skill as a git skill; registry skill ids are not accepted. MCP servers and models fall back to the registry when a name is missing. Other routes reject these headers.
