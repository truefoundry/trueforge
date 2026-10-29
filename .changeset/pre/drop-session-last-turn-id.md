---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Drop the redundant `last_turn_id` column from sessions; the session tip is now read from `last_turn_details.id`.
