---
"@truefoundry/trueforge-ui": minor
---

Add global Schedules page at `/schedules` with listing, popover-based filters, and create/edit drawer wired to the schedule API. New schedules save as paused, open a Test Schedule review with MCP connect status, and support Activate Anyway. List schedules uses server token pagination and multi-agent filters. Agents shows a Schedules count column (warning when any are paused) loaded via a batched list for on-screen agents. Add Table primitives with client-side and token pagination plus portal DropdownMenu so row actions are not clipped by overflow. Export a reusable popover select with single- and multi-select modes.
