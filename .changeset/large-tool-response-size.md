---
'@truefoundry/trueforge-core': patch
---

Blocked large tool response messages now state the exact content size and the blocking thresholds in characters (`Content too large (50,000 characters). Tool responses are blocked at 24,000 characters or more per response, or 40,000 characters or more across parallel responses. Result saved to: …`, at the default thresholds), and the file-dump message prompts the model to plan reads against the total instead of guessing with small incremental reads.
