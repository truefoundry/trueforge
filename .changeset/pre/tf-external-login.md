---
"@truefoundry/trueforge": patch
---

TrueFoundry-mode `/api/v1/auth/login` redirects to `PUBLIC_BASE_URL` origin + caller `return_to` (platform `/signin/external?redirectPath=…`).
