---
'@truefoundry/trueforge-ui': patch
---

Show successful MCP authentication in chat, automatically continue after every required server connects, and indicate while the turn is starting. Confirm OAuth against the chat MCP connector read (`getMcpConnector`) so non-admins are not blocked by settings-only catalog GETs, and ignore authorize callbacks after the prompt unmounts.
