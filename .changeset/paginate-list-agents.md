---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-ui": patch
"@truefoundry/trueforge-sdk": patch
---

Paginate `GET /api/v1/agents` with `limit` / `page_token` and a `pagination` envelope; Agents library uses rows-per-page and prev/next against the token-paginated API.
