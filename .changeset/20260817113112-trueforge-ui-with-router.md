---
'@truefoundry/trueforge-ui': minor
'@truefoundry/trueforge': patch
---

Add opt-in `withRouter` URL sync for shell places (`/`, `/agents/:agentName`, `/sessions/:sessionId`, `/settings`), with path customization via `routes` and `react-router-dom` as an optional peer. Serve the app shell for client-side deep links from the TrueForge server.
