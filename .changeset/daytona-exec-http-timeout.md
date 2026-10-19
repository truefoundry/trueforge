---
'@truefoundry/trueforge': patch
---

Set Daytona `requestTimeoutMs` to 60s so the SDK applies a per-exec HTTP deadline (command timeout + 5s) and a hung toolbox response cannot leave a turn blocked without a tool.response.
