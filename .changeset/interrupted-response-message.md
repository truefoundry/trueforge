---
"@truefoundry/trueforge-core": patch
---

Replace the AI SDK's "Response stream ended without a finish reason" wording when a provider closes
the model stream mid-answer. The turn now fails with "Response interrupted: the model provider
closed the stream before the response finished. Retry the request.", which describes what actually
happened instead of reading like a harness bug.
