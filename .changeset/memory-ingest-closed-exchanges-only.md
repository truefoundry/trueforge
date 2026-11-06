---
'@truefoundry/trueforge': patch
---

Memory ingest sends an exchange only once it is closed, so a turn paused on the user is no longer sent early. The `pause_timeout_ms` setting in `TRUEFOUNDRY_MEMORY_SETTINGS` is removed; remove it from any existing configuration.
