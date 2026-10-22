---
'@truefoundry/trueforge-core': patch
---

The sandbox file-dump message for a blocked large tool response now states its exact size (`Content too large (50,000 characters). Result saved to: …`) and prompts the model to plan reads against that total, instead of guessing with small incremental reads.
