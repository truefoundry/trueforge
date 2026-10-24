---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Report logged failures to Sentry except HTTP statuses from 200 through 499, including when that status sits on a wrapped cause. The log message is the Sentry title, and the thrown error is the cause and stack. Those events include the active tenant, request, session, and turn ids, and are tagged with the file that logged them. Printed lines omit that marker even when Sentry is off.
