---
"@truefoundry/trueforge": patch
---

Accept `TRUEFOUNDRY_API_KEY` by string equality for service-to-service auth, and send `x-tfy-assume-user` (tenant system admin) on ServiceFoundry put/delete remote agent so those calls have a tenant.
