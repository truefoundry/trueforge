---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Send `x-tfy-forward-pings: true` on TrueFoundry-mode model invokes. Support per-call LLM header overrides, and stamp `compaction: true` into gateway metadata on context-compaction calls so those requests are visible in traces.
