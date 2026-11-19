---
'@truefoundry/trueforge-ui': patch
---

Hide paused status dots after 48 hours of inactivity, and show failed runs with a circle-xmark icon in the agent session list only (no failure chrome in chat history). Session lists poll running and paused rows every 5 seconds, and a poll that sees a new pause also refreshes the activity time so the dot is not stuck hidden.
