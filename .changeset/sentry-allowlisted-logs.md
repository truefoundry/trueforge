---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Report actionable network, timeout, and internal failures to Sentry when the log is explicitly marked. Provider inference errors, invalid credentials, and client disconnects stay in the logs. Existing direct Sentry captures are unchanged.
