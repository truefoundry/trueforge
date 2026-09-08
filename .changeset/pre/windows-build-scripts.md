---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Keep `npx @truefoundry/trueforge` working on native Windows: import Kysely migrations with `pathToFileURL`, and keep sandbox guest paths POSIX. Source development stays Unix/WSL; CI also runs unit and SQLite store tests on Windows.
