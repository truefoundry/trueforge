---
'@truefoundry/trueforge': patch
---

Pass Daytona `requestTimeoutMs` so the SDK applies its per-exec HTTP deadline (exec timeout + 5s) and a hung toolbox response cannot leave a turn blocked without a tool.response.
