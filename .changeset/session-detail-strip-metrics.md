---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Use session detail API metrics for the agent session strip Turns/Duration/Cost instead of list-row hints or turn-by-turn aggregation. Include optional totalCostInUsd on TurnDoneMetrics so turn.done cost matches the wire contract.
