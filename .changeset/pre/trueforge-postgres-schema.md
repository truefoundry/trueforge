---
"@truefoundry/trueforge": minor
---

Store Postgres app tables and Kysely migration bookkeeping in a dedicated `trueforge` schema, with an automatic one-time move from `public` so existing installs keep their data and migration history.
