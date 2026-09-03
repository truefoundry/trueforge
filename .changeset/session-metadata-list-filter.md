---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge-sdk": patch
---

Add list-sessions metadata containment filter (`metadata` JSON query param) across InMemory/Postgres/SQLite stores, with a partial GIN index on Postgres for `@>` lookups.
