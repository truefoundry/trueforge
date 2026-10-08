---
'@truefoundry/trueforge-ui': patch
---

Encode sandbox artifact paths when building file-download links, so names containing spaces, `#`, `?`, `&`, `%` or non-ASCII characters resolve to the intended file instead of a truncated or misparsed URL.
