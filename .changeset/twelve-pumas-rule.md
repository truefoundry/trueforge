---
"@truefoundry/trueforge-core": patch
---

Add 502 and 503 status codes to SSRF fetch retry logic. These errors indicate temporary upstream failures and are now eligible for automatic retries across model, MCP, and outbound fetch operations.

