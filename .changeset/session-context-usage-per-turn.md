---
'@truefoundry/trueforge-ui': patch
---

Fix the session Context Usage metric, which summed every turn's token spend and so always matched the Tokens tile and could never fall after compaction. Context is now read as a snapshot from the last root model call of each turn.
