---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Route the root thread when the spec model is `auto`. The spec is accepted only when model routing is on for the tenant, and it cannot carry model params. The root runs on the cheapest model and effort in the chosen cluster. If routing cannot choose one, the turn fails. A rebuilt turn resumes on the saved model and effort.
