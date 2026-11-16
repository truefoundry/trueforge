---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Backfill missing `config.sandbox.environment_name` on saved agents and inline session specs that have sandbox enabled, pinning each to the tenant default environment (or `trueforge-sandbox-env` when no default is set). Docs now require the field when sandbox is enabled instead of documenting omit-as-default.
