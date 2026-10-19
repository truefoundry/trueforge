---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Bound Daytona sandbox exec waits with a client HTTP deadline (exec timeout + 5s) so a hung toolbox response cannot leave a turn blocked without a tool.response.
