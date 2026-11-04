---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-sdk': patch
---

Add a Memory toggle to the agent builder, shown only when the tenant has a memory provider.

Add a tenant-wide memory switch to `/api/v1/settings/configuration` and a Memory settings section. The switch starts off for every tenant. While it is off, capabilities report memory as unavailable, saving a spec that turns `config.memory` on is rejected with 422, and chats and ingestion skip the tenant.

Add memory providers, mirroring web search providers: a Zep catalog at `/api/v1/catalogs/memory-providers` and a per-tenant provider at `/api/v1/settings/memory-providers`, managed from Settings → Memory in OSS. In TrueFoundry mode the provider comes from `TRUEFOUNDRY_MEMORY_*` env (allowlisted tenants only) and cannot be changed. Without a provider, capabilities omit `memory` and the UI hides every memory setting. Chats and memory ingestion use each tenant's own provider, so a provider saved in settings works like the platform's; standalone servers now run ingestion too.
