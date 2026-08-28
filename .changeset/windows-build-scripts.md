---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Make build, test, and standalone startup Windows-compatible: shared rm/chmod scripts, `cross-env` for env prefixes, POSIX sandbox shell paths, Kysely migration imports via `pathToFileURL`, and Windows-safe package export smoke test handling.
