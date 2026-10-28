---
'@truefoundry/trueforge-core': patch
---

Large tool response guidance now includes content size in the blocked preamble for MCP and sandbox dumps, shares the same "Content too big (size; reason)" framing, uses RFC 2119 wording (MUST/MAY/SHOULD), and states the per-response character limit for dumped-file reads and oversized sandbox stdout. Elevated tools (deferred-tools `get_tool_info` only) skip offload up to min(50000 characters, 80% of remaining context). Individual offload uses a strict `>` threshold so the stated character cap is usable. Size figures are plain digits without thousands separators.
