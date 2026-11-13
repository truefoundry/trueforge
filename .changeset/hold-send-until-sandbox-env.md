---
'@truefoundry/trueforge-ui': patch
---

Hold composer send on new drafts until sandbox environments finish loading and the tenant default is pinned, so createSession cannot race ahead missing `environment_name`.
