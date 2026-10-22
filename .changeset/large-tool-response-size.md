---
'@truefoundry/trueforge-core': patch
---

Blocked large tool response messages now state the exact content size and which limit blocked it, in characters (`Content too large (50,000 characters; this response exceeds the 24,000-character limit for a single response). Result saved to: …`, at the default thresholds; responses blocked by the parallel total instead say the parallel responses together exceed the combined limit), and the file-dump message prompts the model to plan reads against the total instead of guessing with small incremental reads.
