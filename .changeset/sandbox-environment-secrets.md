---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Sync sandbox-environment networking secrets to Daytona org secrets on PUT (plaintext is never stored), keep Daytona refs in `sandbox_environment_secret`, and mount those secret names at sandbox create time.
