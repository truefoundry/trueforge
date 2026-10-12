---
'@truefoundry/trueforge-core': patch
---

`extractErrorLogFields` appends each `cause` stack after the outer stack, joined with `Caused by:`. A wrapper captures the boundary rather than the throw site, so the origin frames stay on the same traceback.
