---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-core": patch
---

Bound the Daytona calls reachable from request-handling paths, so a stalled provider fails fast instead of hanging a request.

The sandbox build-status refresh runs on the capability probe, the sandbox settings read, and turn creation, and none of those capped the round-trip. A Daytona endpoint that accepted the connection and then stalled held each request until undici's multi-minute default, piling up connections during a provider brownout. The refresh now uses the same budget the settings write already applied, and reports the last persisted status when it expires rather than hanging or failing the caller.

Snapshot registration also carries its own request timeout. Racing a promise against a timer abandons the result but leaves the request running, so the socket needed a deadline of its own.
