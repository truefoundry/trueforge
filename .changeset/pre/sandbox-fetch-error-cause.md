---
'@truefoundry/trueforge-core': patch
---

[truefoundry] Surface nested `Error.cause` and the sandbox URL when TFY sandbox fetch calls fail, so undici "fetch failed" errors include ECONNREFUSED (and similar) instead of an opaque message. Log when a TFY sandbox file upload starts and finishes.
