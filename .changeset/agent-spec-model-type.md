---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-sdk': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

The agent spec `model` is now a `type`-keyed union: `{ type: "fixed", name, params? }` or `{ type: "auto", candidate_models }` (4 to 10 models that can route every category). A migration rewrites saved agents and inline session specs: named models become fixed, and Auto copies `candidate_models` from the tenant configuration.
