---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Add a Docker sandbox provider with optional GPU passthrough, widen the sandbox provider manifest to a discriminated union, and let a provider declare whether it supports Code Mode so sessions degrade instead of failing.
