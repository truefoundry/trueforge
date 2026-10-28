---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Retry ServiceFoundry GET calls after a dropped connection, a timeout, or a retryable gateway status. Writes stay a single attempt. `TRUEFOUNDRY_SERVICEFOUNDRY_HTTP_MAX_RETRIES` defaults to 2.
