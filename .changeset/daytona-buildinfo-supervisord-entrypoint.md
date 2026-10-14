---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Preserve supervisord ENTRYPOINT on Daytona custom-environment buildInfo snapshots so the sandbox NATS bridge starts (Daytona otherwise defaults to sleep infinity).
