---
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Fix older chat history not rendering when a session event page ends mid-turn: the split turn is now held and joined with the next older page instead of being dropped.
