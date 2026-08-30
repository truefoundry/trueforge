---
"@truefoundry/trueforge": minor
"@truefoundry/trueforge-ui": minor
"@truefoundry/trueforge-sdk": patch
---

Add an optional `api_url` to the Daytona sandbox provider manifest, with a matching field in the sandbox settings form, so TrueForge can be pointed at a self-hosted Daytona instance. When omitted, the default cloud endpoint is used and behaviour is unchanged.
