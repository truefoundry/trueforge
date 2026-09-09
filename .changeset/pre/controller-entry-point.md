---
"@truefoundry/trueforge": patch
---

Add a dedicated controller entry point (`dist/controller-main.js`) that runs the periodic control loops (schedule dispatch) as a single-replica process for distributed mode (`STANDALONE=false`). It targets the server API via the new `SERVER_URL` env (default `http://localhost:$PORT`). Standalone mode keeps running the controller inside the server process.
