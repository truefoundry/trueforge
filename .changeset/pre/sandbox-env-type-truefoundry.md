---
'@truefoundry/trueforge': patch
---

Sandbox environments created or updated in TrueFoundry mode now store `type: truefoundry` while `sandbox_provider` keeps the backing provider (e.g. Daytona). A TrueFoundry-mode-only migration backfills `type` on existing environment versions.
