---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Gate Environments chrome and CRUD on provider env support: hide UI and return 422 when the shared TrueFoundry sandbox has no snapshot/env concept. Capabilities expose `sandbox.environments.enabled` for that gate.
