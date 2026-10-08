---
'@truefoundry/trueforge-core': patch
---

`extractErrorLogFields` now reports `cause_stack`, the stack of the deepest `cause` that carries one. An error rethrown at a boundary captures that boundary rather than the throw site, so the origin frames were lost from logs; they are kept alongside the outer stack.
