---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Adopt the loaded session agent spec when resuming chat history so New Chat draft edits no longer PATCH over the saved sandbox environment; lock composer environment selection after a session exists; read/write sandbox `environmentName` so resumed chats show the correct environment; and keep showing a deleted environment from the agent spec.
