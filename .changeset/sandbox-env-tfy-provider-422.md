---
'@truefoundry/trueforge': patch
---

Reject sandbox environment create/upsert with 422 from the TrueFoundry env store when the shared provider has no env/snapshot support. Secret sync no-ops when `envSupported` is false so create reaches that store rejection instead of failing while building a Daytona client.
