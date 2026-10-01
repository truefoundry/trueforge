---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Treat `paused` as a live turn. `updateTurnNonTerminalState` switches `running` and `paused` and appends `turn.update` without session metrics. Terminal writes and `freezeAndGetTurn` accept a paused tip. `createTurn` rejects a paused predecessor until it is frozen. `updateTurnState` is now `updateTurnTerminalState`.
