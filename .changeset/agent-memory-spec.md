---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-sdk': patch
---

Add a Memory toggle to the agent builder, shown once the tenant has a memory provider. In OSS, admins configure Zep in Settings → Memory (`/api/v1/settings/memory-providers`); in TrueFoundry mode it comes from `TRUEFOUNDRY_MEMORY_*` env. A tenant-wide memory switch, off by default, gates memory in chats, ingestion, and agent specs.
