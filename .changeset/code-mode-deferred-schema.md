---
'@truefoundry/trueforge-core': patch
---

When Code Mode is on, always register the deferred meta tools and include every MCP server so `get_tool_output_schema` can resolve result shapes for `preload: true` tools.
