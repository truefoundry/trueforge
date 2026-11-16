---
'@truefoundry/trueforge-core': patch
---

Built-in TrueForge MCP write and destructive tools require approval again, and "approve for this session" and timed approvals now work for them and carry over to later turns. `IToolSet` gains a required `supportsApprovals` flag, and approval policies apply to any tool set (system or user) where it is true. `AgentThread.getUserToolSets()` is replaced by `getToolSets()`.
