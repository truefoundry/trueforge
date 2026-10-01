---
"@truefoundry/trueforge-core": patch
---

Error the turn when finish_reason is tool_calls but the assistant message has no parsed tool_calls, instead of treating it as a successful stop.
