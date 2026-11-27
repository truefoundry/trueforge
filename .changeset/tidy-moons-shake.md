---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Code Mode tool approvals are now decided only on the host. The sandbox MCP client no longer
runs its own destructive-tool check (and its tools cache), and the new
`CODE_MODE_APPROVALS_ENABLED` flag (default off) lets a script wait for approval on a gated
tool instead of being refused.
