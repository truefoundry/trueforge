---
"@truefoundry/trueforge": patch
---

Limit frontend Sentry tracing to session API calls, one trace per call, and record SSE first-chunk latency, stall count and stream errors as span attributes.
