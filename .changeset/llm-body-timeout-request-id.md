---
'@truefoundry/trueforge-core': patch
---

Stamp `x-tfy-request-id` on each model call and include that id with model name and gateway URL on all LLM error logs so harness logs can be correlated with AI Gateway traces.
