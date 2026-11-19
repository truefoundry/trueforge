---
'@truefoundry/trueforge-core': patch
---

Tag every model call with `tfg.thread_id` in TrueFoundry gateway metadata, including context-compaction calls, so gateway traces can be grouped by thread.
