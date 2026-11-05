---
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-ui": patch
---

Remove the `limit` parameter from `listTurns`, `listEvents`, `listTurnEvents`, and `listSessionEvents` on the server ports; page size for these lists is now controlled only by the server configuration.
