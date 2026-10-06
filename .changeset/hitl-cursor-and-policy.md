---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Keep the subscribe sequence cursor when a paused fallback has no new event id, and only offer session/timed allow on deferred `call_tool` MCP targets (other tools still send allow-once).
