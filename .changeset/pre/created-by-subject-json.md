---
'@truefoundry/trueforge-core': major
'@truefoundry/trueforge': major
---

Replace string creator fields (`created_by` / `triggered_by`) with a non-null `created_by_subject` JSON object on agent, session, schedule, and schedule_run. Ownership and list filters use `tenant_id` + `created_by_subject.subject_id`.
