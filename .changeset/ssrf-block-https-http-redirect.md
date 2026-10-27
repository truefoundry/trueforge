---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Block HTTPS-to-HTTP redirects in the outbound SSRF-guarded fetch so cleartext downgrades cannot follow a secure hop.
