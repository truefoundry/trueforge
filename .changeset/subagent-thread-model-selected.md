---
'@truefoundry/trueforge-core': patch
---

Subagents get their model from the orchestrator too: each is created without one, and the orchestrator selects it before the subagent's first model call and records `thread.model_selected`, so `thread.created` no longer carries a model. Threads that resume on a saved model are restored by the orchestrator the same way, without a new event. `ITurnResourceResolver.resolveModel` now routes a subagent on its delegated task, falls back to an Auto root's model, and returns the selection's outcome; `routeModel` is replaced by `autoModelRouterAvailable`.
