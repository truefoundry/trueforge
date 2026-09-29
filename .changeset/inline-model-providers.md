---
"@truefoundry/trueforge": patch
---

Accept `x-tfg-models` in TrueFoundry mode alongside `x-tfg-mcp` and `x-tfg-skills`: model providers a request defines by name, each an OpenAI-compatible endpoint with its own `base_url`, optional `auth.api_key`, and `models`. A spec's `provider/model` resolves against them for validation and turn execution, taking precedence over the tenant registry for that request only; unfiltered provider and model lists still show only configured resources.
