---
"@truefoundry/trueforge-ui": patch
---

Add a "Remove" button to configured connectors in Settings → Connectors, wiring the previously-unimplemented `deleteConnector` now that `DELETE /api/v1/settings/mcp-servers/{name}` exists (#495).
