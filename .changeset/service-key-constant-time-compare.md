---
'@truefoundry/trueforge': patch
---

Compare the service API key with `crypto.timingSafeEqual` so a rejected credential does not leak how much of the key matched.
