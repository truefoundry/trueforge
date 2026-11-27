---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-sdk': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Select each thread's model in the orchestrator, before the thread's first model call, instead of when the thread is built: a new turn's main thread is routed on the conversation and each new subagent on its delegated task. When model routing chooses a model, a new `thread.switch_model` event records it with `model.name` and `model.params.reasoning_effort`, and the model is saved with the thread. Any other model is neither recorded nor saved: a thread resumes on its saved routed model, or else on the model its spec or subagent request names, and rebuilds never route an existing thread. `thread.created` no longer carries a model. An unknown model or a failed Auto routing now ends the turn with an error instead of returning 422. `AgentThreadOrchestrator` takes a required `resolveModel` input; `ITurnResourceResolver.resolveModel` routes subagents, falls back to an Auto root's model and reports how the model was chosen, and `routeModel` is replaced by `autoModelRouterAvailable`. `ISessionStore.createTurn` no longer takes `main_thread_model`, and the new `patchThreadModel` saves a thread's model once chosen.
