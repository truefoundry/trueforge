---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-sdk": patch
---

Add `GET /api/v1/artifacts/{artifact_id}` and `PATCH /api/v1/artifacts/{artifact_id}` to get and rename the caller's artifacts. Artifact names reject control, bidi, and `/ \ : * ? " < > |` characters; whitespace is collapsed and trimmed. The SDK gains `artifacts.get` and `artifacts.update`.
