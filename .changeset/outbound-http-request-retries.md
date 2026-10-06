---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Split outbound HTTP into an agnostic SSRF `createOutboundFetch` plus separate generic/model/MCP Agents (`OUTBOUND_HTTP_*`, `MODEL_HTTP_*`, `MCP_HTTP_*`) with configurable connect/headers/body timeouts and retries.
