---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge-ui": patch
"@truefoundry/trueforge": patch
---

Default MCP tool approval to `@destructive` only. Selecting Other/read-only tools clears approval; selecting destructive tools keeps it on. Migrate mounts still carrying the old `@write`+`@destructive` default.
