---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Add an Artifacts page after Environments. The standalone app shows it when `VITE_ENABLE_ARTIFACTS=true`. The list reads `GET /api/v1/artifacts`. Preview, rename, delete, and file read stay unwired until those routes exist.
