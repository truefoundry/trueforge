---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Stream sandbox file downloads end to end. `SandboxProvider.downloadFile` now returns `{ size, stream }` so the download route can send bytes incrementally (bounded by chunk size, not file size), keep the exact `Content-Length`, stop provider reads when the client disconnects, and re-enforce the size cap while streaming.
