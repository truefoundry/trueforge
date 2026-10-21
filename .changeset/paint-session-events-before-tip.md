---
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Paint a loaded session from its events window before confirming the tip, and stop fetching the oldest turn to decide whether that tip is still running. A send started in that window is kept, and a tip that finishes before its done event is still shown.
