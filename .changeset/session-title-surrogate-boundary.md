---
'@truefoundry/trueforge': patch
---

Truncate derived session titles on grapheme boundaries so emoji clusters are never split, and leave
the title unset when nothing fits instead of storing a blank value.
