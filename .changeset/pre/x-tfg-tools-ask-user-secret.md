---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Accept `x-tfg-tools` as an array of MCP tool definitions (`inputSchema`, optional `outputSchema`) on a TrueFoundry-mode turn. The header is read by a per-request store and mounted on the main thread through `TurnResourceResolver`. Local tool lists keep `outputSchema` and `annotations`.
