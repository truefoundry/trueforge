---
'@truefoundry/trueforge-core': patch
---

Only add the deferred-tool meta tools (`list_tools`, `get_tool_info`, `get_tool_output_schema`, `call_tool`) when an MCP server is `preload: false`, or when a sandbox is attached for Code Mode. Agents whose servers are all `preload: true` no longer get them.
