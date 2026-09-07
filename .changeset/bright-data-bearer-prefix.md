---
"@truefoundry/trueforge-ui": patch
---

Fix header-auth MCP connectors (e.g. Bright Data) rejecting pasted API keys with 401 because the required `Bearer ` scheme prefix wasn't applied. The Connect / Replace Key dialog now tests the pasted key live against the upstream server — as typed, then with a `Bearer ` prefix, then with a `Basic ` prefix — reporting each attempt in the dialog, and stores whichever one actually connects.
