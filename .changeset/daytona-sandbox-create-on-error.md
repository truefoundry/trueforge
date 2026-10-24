---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Surface Daytona sandbox create failures through a host `onError` hook (authz still ignored for P1) instead of a provider-owned critical alert callback.
