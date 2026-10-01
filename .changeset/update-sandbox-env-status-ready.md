---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Update SandboxEnvironmentStatus from 'active' to 'ready' to align with backend environment version readiness, and remove static default environment injection from draft selectors so default comes directly from the server environment listing.
