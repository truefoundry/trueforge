---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-sdk": patch
---

Remove the `created_by_session_id` filter from the list artifacts API, and trim each listed artifact to `id`, `name`, `created_by_subject`, `created_at` and `updated_at`.
