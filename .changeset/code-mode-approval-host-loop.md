---
"@truefoundry/trueforge-core": patch
"@truefoundry/trueforge": patch
---

Add the host side of per-call Code Mode tool approvals: a `code_mode.approval_required` card, a `user.code_mode_approval` decision, a per-turn `CodeModeApprovalBroker`, and the orchestrator loop that carries cards out of a running batch and settles decisions inline.
