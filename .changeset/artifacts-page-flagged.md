---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Add an Artifacts page after Environments. The standalone app shows it when `VITE_ENABLE_ARTIFACTS=true`. The list reads `GET /api/v1/artifacts` with name search, and rename calls the update route. Preview, delete, share, and file read stay unwired until those routes exist.
