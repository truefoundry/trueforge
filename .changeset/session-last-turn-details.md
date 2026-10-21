---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Return `last_turn_details` (`{ id, state: { status } }`, null before the first turn) on sessions from the sessions API, stored as one document on the session. Stores replace the whole document when a turn is created and when that turn pauses, resumes, finishes, or is cancelled; a status change from a turn that is no longer the last turn is ignored. Existing sessions are backfilled from their last turn.
