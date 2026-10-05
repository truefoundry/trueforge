---
'@truefoundry/trueforge-core': minor
'@truefoundry/trueforge': minor
---

Split outbound HTTP into an agnostic SSRF `createOutboundFetch` plus separate generic/model/MCP Agents (`OUTBOUND_REQUEST_*`, `MODEL_REQUEST_*`, `MCP_REQUEST_*`) with configurable connect/headers/body timeouts and retries.
