---
'@truefoundry/trueforge-ui': patch
---

Stop gating the Environments page on `listSandboxProviders` so create/update works when the sandbox provider is supplied externally or that catalog API returns 403.
