---
"@truefoundry/trueforge-core": patch
---

Model call failures now read "Model request failed: <provider>/<model>: <reason>", and logged errors include the cause stacks. Request and response bodies are never logged.
