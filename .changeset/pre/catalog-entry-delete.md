---
"@truefoundry/trueforge-ui": patch
"@truefoundry/trueforge": patch
---

Add `DELETE` for settings catalog entries (model providers, MCP servers, skills), rejected with 409 naming the agents that still reference the entry; a model-provider update that drops a model in use is rejected the same way. Deleting an MCP server also clears its stored OAuth grants. Settings now confirms removals (including connectors) and keeps a refused removal's reason in the dialog; removing a provider's last model removes the provider. The connector list offers Connect on added-but-unauthenticated OAuth servers.
