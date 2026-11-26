---
'@truefoundry/trueforge-core': patch
---

Built-in capabilities read the thread's model on each call instead of capturing it when built, and `ITurnResourceResolver` resolves a thread's model through a separate `resolveModel`; `resolveAgentDefinition` no longer takes or returns a model.
