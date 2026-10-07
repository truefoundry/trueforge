---
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Keep draining the live turn stream after `turn.update` paused so apply-only echoes, later required actions, and `turn.update` running stay on the same SSE until `turn.done`.
