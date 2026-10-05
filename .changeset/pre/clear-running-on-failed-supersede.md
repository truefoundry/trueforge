---
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Clear `isRunning` and aborted stream controllers when a superseding send fails prior to starting `runStream`, and ensure `cancel()` clears `isRunning` after draining the in-flight run.
