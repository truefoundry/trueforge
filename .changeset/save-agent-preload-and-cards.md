---
'@truefoundry/trueforge-ui': patch
---

Save Agent dialog: add a per-connector **preload** toggle (writes `mcp_servers[].preload`), render the capabilities as side-by-side cards, and declutter the modal — inline model/connector/skill chips (model shows its provider logo), the "Connectors" label, no subtitle, content-sized height, and tighter spacing. Tooltips now portal into the nearest `<dialog>` so they render above modal content.
