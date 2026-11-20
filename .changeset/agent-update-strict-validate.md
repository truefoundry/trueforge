---
'@truefoundry/trueforge': patch
---

Apply the same capability checks on agent update as on create: updating an agent now returns 422 if web search or memory is enabled while the tenant switch or provider is missing, or if the named sandbox environment is disabled. Sessions still grandfather stored specs so existing chats keep running.
