---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Session grants now give read access, and sharing with everyone in the tenant is a `tenant` grant. `Session.shared` reflects the tenant grant, and the deprecated `PATCH /sessions/{id} { shared }` now grants or revokes it. Adds the `session_sharing.enabled` capability.
