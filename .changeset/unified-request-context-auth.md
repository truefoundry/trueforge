---
'@truefoundry/trueforge': minor
---

Unify request-scoped RequestContext across standalone, OIDC, and TrueFoundry auth. `/auth/me` now returns `{ tenant_id, subject, is_admin }` (OpenAPI/SDK regen deferred to CI).
