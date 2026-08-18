---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-sdk': patch
'@truefoundry/trueforge-ui': patch
---

Replace MCP authorize `redirect_url` with a same-origin `return_to` path to prevent open redirects after OAuth.
