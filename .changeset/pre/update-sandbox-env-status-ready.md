---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Update SandboxEnvironmentStatus from 'active' to 'ready' to align with backend environment version readiness, remove static default environment injection from draft selectors, fix sandbox provider readiness check latching false on EnvironmentsPage, and drain all sandbox environment pages with limit up to 1000 in agent draft pickers.
