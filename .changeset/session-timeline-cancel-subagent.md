---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Surface cancelled turn reasons and failed sub-agents on the Agent Sessions timeline and metrics; project unfinished nested sub-agents as cancelled when the parent turn is already terminal, remap abort-shaped child thread.done errors (e.g. LLM stream aborted) to cancelled on cancelled turns, and close unfinished sub-agent chart bars at turn.done when thread.done is missing.
