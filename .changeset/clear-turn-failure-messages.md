---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge': patch
---

Classify session failures so the UI shows what went wrong instead of raw transport text.

Failures are now resolved to an error code, the subsystem they came from, and whether a retry can
help. Turn errors carry that alongside the raw text, so the chat shows a readable sentence with the
original message behind a "Show details" disclosure, plus copy and retry controls. Logs gain
`error_code` / `error_source` / `retryable` fields so failures can be counted without parsing
message text, and expected MCP reconnects no longer log at error level.
