---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-ui': patch
---

Sort sandbox environments and agents by most recently updated. Pin the platform-provided `trueforge-sandbox-env` environment before frontend pagination so it appears first without exceeding the selected page size or duplicating rows. Keep API ordering independent of the tenant default flag.
