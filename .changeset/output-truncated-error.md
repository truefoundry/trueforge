---
'@truefoundry/trueforge-core': patch
---

When a model stops at its output token limit, fail the turn with `Output truncated: hit the <N> token limit. Raise max_tokens and retry.` (or "the provider's default token limit" when none was sent) instead of `max_tokens breached`. The tokens used are included when they differ from the limit.
