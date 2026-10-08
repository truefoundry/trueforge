---
'@truefoundry/trueforge-core': patch
---

`extractErrorLogFields` logs the deepest `cause` stack as `stack` when a rethrown error carries one. A wrapper captures the boundary rather than the throw site, so the printed traceback starts at the origin.
