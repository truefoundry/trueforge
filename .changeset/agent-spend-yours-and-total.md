---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Report agent metrics as a pair: the caller's own figures plus the agent-wide ones, which are null when the caller may not see other users' sessions. The agent library spend column now shows "yours / total", with a dash when the total is withheld.
