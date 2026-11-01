---
"@truefoundry/trueforge": patch
---

Add a per-environment enable switch to sandbox environments. `SandboxEnvironment` now carries `enabled` and `disabled_at`, and `POST /api/v1/sandbox-environments/{name}/enable` and `/disable` flip it without rebuilding the snapshot. New chats and agent specs cannot select a disabled environment; chats that already use one keep access. Disabling the tenant `default` environment turns sandboxes and skills off in capabilities. In TrueFoundry mode `default` is now a stored row created on first read instead of an in-memory record.
