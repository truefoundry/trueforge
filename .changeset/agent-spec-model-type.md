---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-sdk': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

The agent spec `model` is now `{ type: "fixed", name, params? }` or `{ type: "auto", candidate_models }` (4 to 10 models).
A migration rewrites saved agents and inline sessions.
