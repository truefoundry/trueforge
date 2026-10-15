---
'@truefoundry/trueforge-core': patch
---

Set `eager_input_streaming` on harness tools and re-attach it on the TrueFoundry OpenAI-compatible chat-completions wire so the gateway can forward fine-grained tool streaming to vendors. Invalid tool-call argument JSON is reported as a distinct parse failure (with raw arguments) instead of a generic tool execution error.
