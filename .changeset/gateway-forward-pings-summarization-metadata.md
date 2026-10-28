---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Send `x-tfy-forward-pings: true` on TrueFoundry-mode model invokes. Support per-call LLM `headers` and `metadata` (TrueFoundry folds metadata into `x-tfy-metadata`), and stamp `tfg.compaction: true` on context-compaction calls so those requests are visible in traces.
