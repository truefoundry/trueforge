---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Session grants now give read access, and sharing with everyone in the tenant is a `tenant` grant. `PATCH /sessions/{id}` no longer accepts `shared`; `Session.shared` reflects the tenant grant. Adds the `session_sharing.users` capability.
