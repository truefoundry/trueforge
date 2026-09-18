---
"@truefoundry/trueforge": patch
---

Cap SQLite leftover WAL at 64 MiB after checkpoint so a full disk cannot grow the WAL unbounded.
