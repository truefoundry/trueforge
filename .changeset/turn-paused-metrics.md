---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Add each running stretch's cost when a turn pauses or finishes, keep `running_since` so cancel can close the open interval, and include metrics so far on the paused turn. A freeze writes that same cancelled state onto `turn.done`.
