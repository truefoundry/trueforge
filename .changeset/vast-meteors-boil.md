---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-sdk': patch
'@truefoundry/trueforge-ui': patch
---

Wrap settings MCP, skills, model-provider, and sandbox create/put bodies as `{ manifest }`. List/get items nest the stored document (`name` plus `manifest`, plus derived fields). Create returns 201. Chat lists and catalogs stay flat. Adapter catalogs follow the new SDK shapes.
