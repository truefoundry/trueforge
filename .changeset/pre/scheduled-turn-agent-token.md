---
"@truefoundry/trueforge": minor
---

Schedule runs now execute through one internal API call authenticated with `TRUEFORGE_API_KEY`. The server loads the saved run, schedule, and agent, then uses one agent-scoped token for turn resources in TrueFoundry mode.
