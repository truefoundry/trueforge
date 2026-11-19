---
'@truefoundry/trueforge-ui': patch
---

Slow chat-history session polling to 30 seconds and skip a tick while a list request is still in flight. The open chat no longer keeps that poll running, and a chat whose activity time moves forward sorts to the top of the sidebar. Approving a paused turn clears its waiting dot from the live transcript instead of leaving it until the next sessions poll.
