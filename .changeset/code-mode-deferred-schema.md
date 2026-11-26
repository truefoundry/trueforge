---
'@truefoundry/trueforge-core': patch
---

When Code Mode has user MCP servers, register the deferred meta tools (including system toolSets) so `get_tool_output_schema` can resolve result shapes for `preload: true` tools. A sandbox alone with only builtins does not add them.
