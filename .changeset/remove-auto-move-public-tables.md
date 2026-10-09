---
'@truefoundry/trueforge': patch
---

Remove `AUTOMATICALLY_MOVE_TRUEFORGE_TABLES_FROM_PUBLIC_TO_TRUEFORGE_SCHEMA` and the Postgres bootstrap that moved public tables into `POSTGRES_SCHEMA`; schema creation stays with the Migrator and init migration.
