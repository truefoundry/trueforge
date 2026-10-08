---
'@truefoundry/trueforge': patch
---

Log a traceback for every error that leaves the server as a non-2xx response. Thrown `HTTPException`s below 500 were returned with nothing in the log but the access-log line, so a 400/422/424 could not be traced to the code that raised it. Route handlers that caught an error and converted it into a client error now rethrow it as an `HTTPException` carrying the original as `cause`, and OpenAPI request validation throws instead of answering directly, so the app error handler is the one place that builds the error envelope and logs it. Each line carries method, path, status, the error chain, and the stack. When the handler rethrows with `cause`, that stack is the original throw. Routine `401`/`403`/`404` rejections stay at debug level.
