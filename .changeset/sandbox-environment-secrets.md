---
'@truefoundry/trueforge': minor
'@truefoundry/trueforge-core': minor
---

Sync sandbox-environment networking secrets to Daytona org secrets on PUT (plaintext is never stored), keep Daytona refs in `sandbox_environment_secret`, and mount those secret names at sandbox create time.
