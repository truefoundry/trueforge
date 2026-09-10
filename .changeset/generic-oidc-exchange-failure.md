---
'@truefoundry/trueforge': patch
---

Stop reflecting the raw token-exchange error into the OIDC failure redirect. The message carried upstream endpoint and issuer detail into the browser's address bar; failures now use the same generic `login_failed` reason as the other callback paths, with full detail kept in the server log.
