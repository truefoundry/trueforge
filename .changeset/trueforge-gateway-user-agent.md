---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Prepend `user-agent: trueforge/<version>` on model and MCP outbound fetches (via `OutboundFetchOptions.userAgent`) and on ServiceFoundry server calls so TrueFoundry can identify TrueForge traffic and its version.
