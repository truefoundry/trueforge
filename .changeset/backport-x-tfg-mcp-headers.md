---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Backport `x-tfg-mcp-headers` per-MCP-server headers. An entry `Authorization` (any casing) skips DCR in open-source mode; TrueFoundry mode forwards entries as `x-tfy-mcp-headers` without calling authorize before connecting. A 401 fails when the entry carried credentials, otherwise the `onUnauthorized` hook offers consent.
