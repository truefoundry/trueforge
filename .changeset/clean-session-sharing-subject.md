---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-ui": patch
---

Remove the deprecated session `shared` field and PATCH sharing flow in favor of access grants. Rename the exported `CreatedBySubject` schema/type to `Subject` without changing creator fields. These API and type removals are breaking changes for consumers.
