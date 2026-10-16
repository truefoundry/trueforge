---
'@truefoundry/trueforge': patch
---

Only TrueFoundry-mode turns on inline sessions may send `x-tfg-*` skill/MCP/model headers. Session and agent saves reject those headers and validate skills with the caller JWT against the registry. `x-tfg-skills` does not accept skills from the TrueFoundry Skills Registry.
