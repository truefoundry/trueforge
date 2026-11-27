---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Add the `push_artifact` tool (per-tenant `ARTIFACTS` setting; needs `S3_CONFIG`, non-standalone only): checks a sandbox directory against the limits, uploads it to S3 from the sandbox with presigned URLs, verifies it and records a new artifact version.
