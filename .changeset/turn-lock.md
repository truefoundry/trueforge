---
'@truefoundry/trueforge': patch
---

Serialize inbound turn events and local cancel per turn so concurrent requests on the same turn cannot interleave, while different turns still run in parallel.
