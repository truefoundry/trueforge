---
"@truefoundry/trueforge": patch
---

Match the secret redaction sentinel exactly, and publish at most the last four characters of a stored secret.

A settings write that carried `***REDACTED***` anywhere inside a real secret was treated as "keep the stored one", so the value the user typed was silently discarded — the old secret stayed, or a create failed with a message about a missing key. Only the mask a `GET` actually returns is treated as a keep now.

Responses previously showed the first three and last three characters of any secret of ten characters or more, which left little of a short key unknown. A secret now masks to its last four characters and only when it is at least twelve long; anything shorter is masked completely.
