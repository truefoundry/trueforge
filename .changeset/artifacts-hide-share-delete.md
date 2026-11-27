---
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Hide Share and Delete from the artifact row menu until the API supports them, and rename artifacts through a React Query mutation. The artifact preview URL now derives from `routes.paths.artifacts`, so the separate `paths.artifact` option is removed.
