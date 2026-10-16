---
'@truefoundry/trueforge': patch
---

Only TrueFoundry-mode turns on inline sessions may send `x-tfg-*` skill/MCP/model headers; session and agent saves validate skills with the caller JWT against the registry. When `x-tfg-skills` is set, every skill named in the spec must be defined in that header (no registry lookup).
