---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-sdk': patch
---

Report a sandbox command that hits its time limit as a failure, and show a tool call that returned an error as failed. The `tool.response` event now carries an optional `is_error` flag.
