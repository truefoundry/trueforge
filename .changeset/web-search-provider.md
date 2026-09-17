---
"@truefoundry/trueforge-core": minor
"@truefoundry/trueforge": minor
---

Add built-in web search/fetch system tools (Parallel via `parallel-web`), gated by `AgentSpec.config.web_search` (default off) and TrueFoundry-mode host env `TRUEFOUNDRY_WEB_SEARCH_PROVIDER`. New drafts seed `web_search.enabled` from `/capabilities` when a provider is configured.
