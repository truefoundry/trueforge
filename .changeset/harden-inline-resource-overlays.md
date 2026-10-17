---
'@truefoundry/trueforge': patch
---

In TrueFoundry mode, `x-tfg-skills`, `x-tfg-mcp`, and `x-tfg-models` are accepted when creating an inline session, when replacing an inline session's spec, and on turns for an inline session.

Create and spec replace use the headers only to check the spec. The session stores the spec, not the header values. A turn uses the headers for that turn.

`x-tfg-skills` is a closed list of git skills. Every skill name on the spec must be in the header. Registry skill ids are not accepted there. MCP servers and models still use the registry when the name is missing from the header.

Other routes, including agent save and turns for a named agent, reject these headers. `x-tfg-mcp-headers` is not part of this check.
