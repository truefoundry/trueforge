---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Add auto model selection for the root thread. An agent whose spec model is `auto` is accepted only when model routing is enabled for the tenant, and its root is routed on every turn: the classifier sees the conversation's user and assistant text, with attachment names and content types instead of file contents, and the new user message. The root runs on the cheapest model and effort in the chosen cluster. If routing cannot choose a model, the turn fails. A rebuilt turn resumes on the root's saved model.
