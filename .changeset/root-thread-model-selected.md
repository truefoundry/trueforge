---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-sdk': patch
---

Select the main thread's model when a new turn starts running instead of when the turn is created, and record it with a `thread.model_selected` event (`outcome: explicit | picked`). `turn.created` now reports `main_thread_model: null` for new turns. An unknown model or a failed Auto routing now ends the turn with an error instead of returning 422. `AgentThreadOrchestrator` takes a required `resolveModel` input that selects that model. `ISessionStore.createTurn` no longer takes `main_thread_model`; a new turn's main thread starts with no model, and the new `patchThreadModel` records it once selected.
