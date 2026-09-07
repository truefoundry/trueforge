---
"@truefoundry/trueforge": minor
---

Schedule runs now execute through one internal API call authenticated with `TRUEFORGE_API_KEY`. The server loads the saved run, schedule, and agent, then uses an agent-scoped token for models and MCP servers in TrueFoundry mode.
