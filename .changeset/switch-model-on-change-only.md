---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Record a fixed model spec's model on the main thread in the createTurn insert, and emit `thread.switch_model` only when routing picks a different model or effort.
