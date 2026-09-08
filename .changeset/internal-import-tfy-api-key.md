---
"@truefoundry/trueforge": patch
---

Accept `TRUEFOUNDRY_API_KEY` only on `/api/internal/import` (not user session auth), and send `x-tfy-assume-user` (tenant system admin) on ServiceFoundry put/delete remote agent so those calls have a tenant.
