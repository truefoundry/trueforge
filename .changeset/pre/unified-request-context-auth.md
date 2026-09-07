---
'@truefoundry/trueforge': minor
---

Unify request-scoped RequestContext across standalone, OIDC, and TrueFoundry auth. `/auth/me` returns `{ data: { type, tenant_id, subject, roles } }` (`type` is `oidc-connected` | `default`; OpenAPI/SDK regen deferred to CI).
