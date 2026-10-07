---
'@truefoundry/trueforge': patch
---

Log a traceback for every error that leaves the server as a non-2xx response. Thrown `HTTPException`s below 500, `ZodError`s and `InvalidCronError`s previously returned their status with nothing in the log but the access-log line, so a 400/422/424 could not be traced to the code that raised it. Each one now logs its method, path, status, error chain and stack; routine `401`/`403`/`404` rejections stay at debug level. Route handlers that catch an error and convert it into a 400/422/424 log it the same way.
