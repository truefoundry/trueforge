---
"@truefoundry/trueforge-core": patch
---

Fail Redis request-reply waits when the executor heartbeat expires during polling instead of waiting until replyTimeoutMs.
