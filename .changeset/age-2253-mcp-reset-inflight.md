---
"@truefoundry/trueforge-core": patch
---

Keep a shared remote MCP transport open while sibling tool calls are in flight so a session-expired reset cannot fail them with a non-retried close error.
