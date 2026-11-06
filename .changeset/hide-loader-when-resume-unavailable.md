---
'@truefoundry/trueforge-assistant-ui-runtime': patch
'@truefoundry/trueforge-ui': patch
---

Hide the running-message activity indicator when the turn cannot be resumed, and restore the in-chat waiting notice for that state. Also keep create-turn reconnect and ensureTurnSubscription in that waiting state instead of treating a missing subscribe path as a completed stream. Cancel of an unsubscribable turn finalizes the local tip so a stale running message cannot revive the loader.
