---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Add the `push_artifact` tool (behind the per-tenant `ARTIFACTS` setting): validates a sandbox directory, uploads it to S3 from the sandbox with presigned URLs, verifies it and records a new artifact version.
