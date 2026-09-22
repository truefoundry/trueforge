---
'@truefoundry/trueforge': minor
'@truefoundry/trueforge-core': minor
---

Add Redis Sentinel + TLS with exclusive transport fail-fast (`REDIS_CONNECTION` DU). Redis is optional at config load for controller/migrate; server still requires it at connect. Sentinel shared-client errors no longer stop the peering heartbeat.
