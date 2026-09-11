---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-ui": patch
"@truefoundry/trueforge-sdk": patch
---

Paginate `GET /api/v1/agents` with `limit` / `page_token` and a `pagination` envelope; optional `agent_name` filters by case-insensitive substring. Agents library uses rows-per-page and prev/next against the token-paginated API. Schedule create and the schedules listing agent filter use a searchable agent combobox backed by the same filtered list API.
