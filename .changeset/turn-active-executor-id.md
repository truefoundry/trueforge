---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Persist turn ownership as `active_executor_id` on the turn row, mint plain ULID turn ids, and peer cancel via the DB owner instead of embedding the executor in the turn id.
