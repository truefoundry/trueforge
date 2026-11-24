---
"@truefoundry/trueforge-ui": patch
---

Cache session lists, session details, and chat history through the shared server query client. History pages are keyed by the session's `updatedAt` and bypass the cache while a turn runs, so reopening a session stays instant without showing stale events.
