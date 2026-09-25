---
'@truefoundry/trueforge-ui': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Keep the composer interactive during running and paused turns: Cancel only when empty, Send supersedes the prior client stream without cancelSession (preserving superseded in-flight turns in the transcript), and stacked pause chrome is abandoned after a later user message. Hosts that override ComposerSendButton and still branch only on isRunning should update to use hasContent.
