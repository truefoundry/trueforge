---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Namespace all Redis keys and pub/sub channels under `tfg:` so TrueForge can share a Redis instance without colliding with other apps.
