---
"@truefoundry/trueforge-ui": patch
---

Cache server reads behind a per-server React Query client, and load capabilities through it so refreshes and server swaps stay correct without a host QueryClientProvider.
