---
'@truefoundry/trueforge': patch
---

Access-log lines now carry `subject_type` and `subject_id` for authenticated requests, including callers rejected by an admin-only route. Unauthenticated requests omit both fields.
