import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import type { Context } from 'hono';
import type { Logger } from 'winston';

/** Expected rejections whose stack says nothing a reader needs; kept out of warn-level logs. */
const QUIET_CLIENT_ERROR_STATUSES = new Set([401, 403, 404]);

/**
 * Every error leaving the server as non-2xx gets one line with its traceback, so a failed
 * request can be traced to the throw site instead of only the access log's status code.
 */
export function logRequestError({
  logger,
  c,
  status,
  error,
  message,
}: {
  logger: Logger;
  c: Context;
  status: number;
  error: unknown;
  message: string;
}): void {
  const fields = {
    method: c.req.method,
    path: c.req.path,
    status,
    ...extractErrorLogFields(error),
  };
  if (status >= 500) {
    logger.error(message, fields);
    return;
  }
  if (QUIET_CLIENT_ERROR_STATUSES.has(status)) {
    logger.debug(message, fields);
    return;
  }
  logger.warn(message, fields);
}
