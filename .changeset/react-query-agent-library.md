---
"@truefoundry/trueforge-ui": patch
---

Cache the agent library, agent details, and draft catalog reads on the server React Query client so repeat opens reuse the last result until a mutation invalidates them.
