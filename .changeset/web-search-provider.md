---
"@truefoundry/trueforge-core": minor
"@truefoundry/trueforge": minor
---

Add built-in web search/fetch system tools (Parallel via `parallel-web`, turbo mode), gated by `AgentSpec.config.web_search` and TrueFoundry-mode host env `TRUEFOUNDRY_WEB_SEARCH_PROVIDER`. Existing named agents and inline session specs are migrated to `web_search.enabled: false`.
