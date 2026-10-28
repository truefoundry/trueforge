---
'@truefoundry/trueforge-core': patch
---

Large tool response guidance now includes content size in the blocked preamble for MCP and sandbox dumps, shares the same "Content too big (size; reason)" framing, uses RFC 2119 wording (MUST/MAY/SHOULD), and states the per-response character limit for dumped-file reads and oversized sandbox stdout. Elevated tools (e.g. `get_tool_info`) skip offload up to min(50,000 characters, remaining context).
