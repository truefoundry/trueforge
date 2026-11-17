---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Built-in TrueForge MCP write and destructive tools require approval again, and "approve for this session" and timed approvals now work for them and carry over to later turns. `IToolSet` gains a required `supportsApprovals` flag, and approval policies apply to any tool set (system or user) where it is true. `AgentThread.getUserToolSets()` is replaced by `getToolSets()`.

- The built-in TrueForge MCP now tells the agent it can attach configured MCP servers and skills to the current chat. After attaching one, the agent asks the user to send another message, because the new tools are available from the next message.
- TrueForge MCP internal API tool calls use the process mTLS fetch and the caller's credential directly, instead of the Fern SDK passthrough client.
