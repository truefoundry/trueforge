---
'@truefoundry/trueforge-core': patch
---

Blocked large tool response messages now state the exact content size and which limit blocked it, in characters (`Content too large (50,000 characters; this exceeds the 24,000-character tool call response limit). Result saved to: …`, at the default thresholds; responses blocked by the parallel total instead say the parallel tool call responses together exceed the combined tool call response limit), and the file-dump message prompts the model to plan reads against the total instead of guessing with small incremental reads.
