---
'@truefoundry/trueforge': patch
---

Bind MCP OAuth callbacks to the TrueForge session in the browser. Completing consent now requires an authenticated session whose subject matches the pending authorization's user, so a forwarded authorize URL cannot attach another user's grant to the initiator's account.
