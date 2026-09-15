---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-ui": patch
---

Expose tenant create grants on list-permissions (`resource_type: tenant`) via a `{ type, permissions }` envelope, and gate Build Agent / New Agent on `permissions.agent` including `CREATE`.
