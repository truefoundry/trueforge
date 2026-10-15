---
'@truefoundry/trueforge': patch
---

Fail-closed `x-tfg-*` overlays: only TrueFoundry-mode turns on inline sessions may supply them; session/agent save validates skills with the caller JWT against the registry. Inline skills are a closed set with no registry fallthrough.
