---
'@truefoundry/trueforge': minor
---

Unify request-scoped RequestContext across standalone, OIDC, and TrueFoundry auth. `/auth/me` returns `{ data: { tenant_id, subject, roles } }` (OpenAPI/SDK regen deferred to CI).
