---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Await Daytona snapshot registration on sandbox provider configure so auth failures return 422 instead of a false pending status, and keep GET status refreshes persisted.
