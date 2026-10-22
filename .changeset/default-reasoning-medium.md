---
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Default the reasoning effort to `medium` when the selected model offers it (falling back to the lowest real effort otherwise), instead of defaulting to the lowest effort. TrueFoundry model listing now passes `mergeParams` to the provider-integrations API so provider-level parameter defaults are included in each model's advertised parameters.
