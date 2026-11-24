---
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Try Again and edit rewind from the loaded history when the parent turn is loaded, even if older turns are still on history pages. When the parent is not loaded, the fallback fetches only the newest window of its chain instead of downloading every earlier page before the new reply starts.
