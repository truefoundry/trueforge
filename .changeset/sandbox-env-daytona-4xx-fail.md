---
'@truefoundry/trueforge': patch
---

Mark sandbox environment builds failed when Daytona rejects snapshot registration with a 4xx (for example disk over the per-sandbox cap), instead of leaving them pending after a 500.
