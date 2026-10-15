---
"@truefoundry/trueforge": patch
---

Use the `rediss://` URL scheme for standalone Redis when `REDIS_TLS_ENABLED` is true so TLS connections advertise the secure protocol in the connection URL.
