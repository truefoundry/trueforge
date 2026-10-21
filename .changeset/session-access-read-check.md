---
"@truefoundry/trueforge": patch
---

Session grants give read access. Sessions can be shared with the whole tenant through a `tenant` access grant; `PATCH /sessions/{id} { shared }` is now a deprecated alias for it.
