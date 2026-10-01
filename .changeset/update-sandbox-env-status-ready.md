---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Update SandboxEnvironmentStatus from 'active' to 'ready' to align with backend environment version readiness, remove static default environment injection from draft selectors, and fix sandbox provider readiness check latching false on EnvironmentsPage.
