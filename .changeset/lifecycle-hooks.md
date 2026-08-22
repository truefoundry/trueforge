---
'@truefoundry/trueforge-core': minor
'@truefoundry/trueforge': minor
---

Add lifecycle hooks: operator-configured commands that run at agent lifecycle events (`user_prompt_submit`, `pre_tool_use`, `post_tool_use`, `turn_done`), configured via a `hooks.json` file (`TRUEFORGE_HOOKS_PATH`, off by default). Blocking events can veto a prompt or tool call; the model sees the deny reason as an error tool result. trueforge-core gains `AgentCapability.toolSetDecorators` (applied to every toolset at tool-initialization time, to the deferred-tool proxy's underlying servers, and to the toolsets Code Mode dispatches against), the `lifecycleHooks` builtin capability, an `IToolSet.unwrapped` decorator seam with `unwrapToolSet`, an `extraCapabilities` passthrough on `TurnResourceResolver`, and exports `ApprovalDecisionSchema`.
