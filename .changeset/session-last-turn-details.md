---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Sessions now return `last_turn_details` (`{ id, state: { status } }`, null before the first turn), kept in sync as the last turn changes status. Existing sessions are backfilled.
