---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Paint cached session timelines immediately in history and always refresh them in the background via a per-shell events cache shared with chat. Keep a turn's trailing events when a history page boundary splits it, and attach them when the older page that holds `turn.created` loads. Project a session's events during render so history does not flash a skeleton before the transcript.
