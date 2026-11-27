---
'@truefoundry/trueforge-core': patch
---

Tag TrueForge model gateway calls with `tfg.model_selection` so KV and usage can tell auto mode from user-picked models: `auto` when model routing owns the thread's model, and `fixed` on the router's classifier call.
