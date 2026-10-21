---
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Paint a loaded session from its events window before confirming the tip, and stop fetching the oldest turn to decide whether that tip is still running. A send that applies its message in that window is kept, a send that fails before then still lets the load finish, and a tip that finishes before its done event is still shown.
