---
'@truefoundry/trueforge': patch
---

Fix PostgreSQL 13 compatibility when persisting MCP server selections and sandbox info by using jsonb_set instead of JSONB subscript assignment.
