---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge-sdk": patch
---

Add caller-owned session `metadata` (`Record<string, string>` with size limits) on create, update, and read. Persist as a new `session.metadata` jsonb column; leave session `custom` unchanged.
