---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Reject approval and tool-response resumes that target a still-running turn before the cancelled-for-next-turn freeze, so an invalid resume such as a duplicate approval no longer cancels the turn it races.
