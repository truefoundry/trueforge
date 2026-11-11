---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Show last-turn status on session lists: warning/failure dots for paused and failed turns, a theme-aware shimmering title and jumping dots while a turn is running, and a desktop hover tip with the full title. Sync Chat History status when the live thread starts or finishes a turn so polling resumes after idle/done rows. The shared text shimmer also updates the assistant "Working..." indicator in light mode.
