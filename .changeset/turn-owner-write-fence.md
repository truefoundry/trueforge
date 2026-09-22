---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Fence turn progress writes with `expected_active_executor_id` so only the owning replica can mutate a running turn; cancel/freeze stays unfenced. Wrong owner raises `TurnExecutorMismatchError`.
