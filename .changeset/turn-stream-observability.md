---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Report turn stream health (started, stalled, disconnected, reconnected, failed, completed, abandoned) through a new vendor-neutral `observability` sink: a breadcrumb per step, and a captured error for stalls and transport failures.
