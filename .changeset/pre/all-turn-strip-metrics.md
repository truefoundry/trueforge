---
'@truefoundry/trueforge-ui': patch
---

Count all event turn.created rows (including MCP-auth resume turns) for the agent session detail strip Turns, Tokens, and Tool calls; keep transcript sections on renderable turns only. Stop overriding strip turn count from getSession metrics. Count pending human-wait tool calls (tool.response_required, e.g. ask-user) in strip Tool calls so they match Agent steps. Strip Tool calls counts only the main agent thread (sub-agent tool calls stay on the Sub-agents tile). Timeline/transcript turn bands fold non-renderable resume turns into the prior user turn (no phantom T2 / user markers). Compress idle between event-turns before folding display bands; aggregate cost/context/tooltip metrics per display band so MCP-auth resumes do not duplicate T1 chart keys or undercount tokens.
